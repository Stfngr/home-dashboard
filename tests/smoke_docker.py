"""Run after docker compose build. Uses disposable containers/network/volume."""
import json
import secrets
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def main():
    prefix = "home-dashboard-test-" + secrets.token_hex(6)
    api, web, volume = prefix + "-api", prefix + "-web", prefix + "-data"
    token = secrets.token_urlsafe(32)

    def request(base, path, data=None, auth=False):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + token
        req = Request(base + path, data=json.dumps(data).encode() if data else None,
                      headers=headers, method="PUT" if data else "GET")
        try:
            with urlopen(req, timeout=3) as response:
                return response.status, response.read()
        except HTTPError as error:
            return error.code, error.read()

    def port(container, internal):
        return "http://" + docker("port", container, internal).splitlines()[0]

    def ready(base, path):
        for _ in range(60):
            try:
                if request(base, path)[0] == 200:
                    return
            except (URLError, TimeoutError, ConnectionError):
                pass
            time.sleep(.5)
        raise AssertionError("Container did not become ready")

    try:
        docker("network", "create", prefix)
        docker("volume", "create", volume)
        docker("run", "-d", "--name", api, "--network", prefix,
               "--network-alias", "home-dashboard-api", "--read-only", "--tmpfs", "/tmp",
               "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
               "-v", volume + ":/data", "-p", "127.0.0.1::8000",
               "-e", "HOME_DASHBOARD_TOKENS=" + json.dumps({"recipe-bot": token}),
               "home-dashboard-home-dashboard-api")
        api_url = port(api, "8000")
        ready(api_url, "/health")
        docker("run", "-d", "--name", web, "--network", prefix,
               "--read-only", "--tmpfs", "/data", "--tmpfs", "/config",
               "-p", "127.0.0.1::80", "home-dashboard-home-dashboard-web")
        web_url = port(web, "80")
        ready(web_url, "/")
        path = "/api/v1/state/recipe-bot/current-recipe"
        assert request(web_url, path)[0] == 404
        data = {"updated_at": "2026-09-21T08:00:00Z", "payload": {
            "date": "2026-09-21", "automatic": False, "recipe": {
                "id": 1, "title": "Rice", "ingredients": ["Rice"], "instructions": ["Cook"]
            }}}
        assert request(api_url, path, data)[0] == 401
        assert request(web_url, path, data, True)[0] == 405
        assert request(api_url, path, data, True)[0] == 200
        assert json.loads(request(web_url, path)[1])["payload"] == data["payload"]
        docker("restart", api)
        api_url = port(api, "8000")
        ready(api_url, "/health")
        assert json.loads(request(web_url, path)[1])["payload"] == data["payload"]
        assert b"Home Dashboard" in request(web_url, "/")[1]
        assert request(web_url, "/app.js")[0] == 200
        assert json.loads(request(web_url, "/dashboard-config.json")[1]) == {
            "state_url": "/api/v1/state/recipe-bot/current-recipe", "demo": False
        }
        print("Docker smoke passed: auth, live web configuration, read-only gateway, recipe roundtrip, restart persistence.")
    finally:
        for container in (web, api):
            subprocess.run(["docker", "rm", "-f", container], capture_output=True)
        subprocess.run(["docker", "volume", "rm", volume], capture_output=True)
        subprocess.run(["docker", "network", "rm", prefix], capture_output=True)


if __name__ == "__main__":
    main()

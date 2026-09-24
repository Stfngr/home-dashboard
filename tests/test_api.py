from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from home_dashboard.api import create_app

TOKEN = "r" * 40
HOUSEHOLD_TOKEN = "h" * 40
URL = "/api/v1/state/recipe-bot/current-recipe"
TASKS_URL = "/api/v1/state/household-agent/current-tasks"


def update(day=21):
    return {"updated_at": f"2026-09-{day:02d}T08:00:00Z", "payload": {
        "date": f"2026-09-{day:02d}", "automatic": False,
        "recipe": {"id": day, "title": "Rice", "ingredients": ["Rice"], "instructions": ["Cook"]}
    }}


def tasks_update(residents=None):
    return {"updated_at": "2026-09-21T08:00:00Z", "payload": {
        "date": "2026-09-21", "residents": residents if residents is not None else [{
            "id": "alex", "name": "Alex", "off_day": False, "tasks": ["Vacuum"]
        }]
    }}


class APITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "state.sqlite"
        self.app = create_app(self.path, {"recipe-bot": TOKEN, "household-agent": HOUSEHOLD_TOKEN,
                                          "weather-bot": "w" * 40})
        self.client = self.enterContext(TestClient(self.app))
        self.auth = {"Authorization": f"Bearer {TOKEN}"}
        self.household_auth = {"Authorization": f"Bearer {HOUSEHOLD_TOKEN}"}

    def test_authentication_and_source_isolation(self):
        self.assertEqual(self.client.put(URL, json=update()).status_code, 401)
        self.assertEqual(self.client.put(URL, json=update(), headers={
            "Authorization": "Bearer incorrect"
        }).status_code, 401)
        self.assertEqual(self.client.put("/api/v1/state/weather-bot/current-weather", json=update(),
                                         headers=self.auth).status_code, 403)
        self.assertEqual(self.client.get(URL).status_code, 404)

    def test_persistence_idempotency_and_older_updates(self):
        self.assertEqual(self.client.put(URL, json=update(), headers=self.auth).json(), {"applied": True})
        modified = update()
        modified["payload"]["recipe"]["title"] = "Changed"
        self.assertEqual(self.client.put(URL, json=modified, headers=self.auth).json(), {"applied": False})
        self.assertEqual(self.client.put(URL, json=update(20), headers=self.auth).json(), {"applied": False})
        with TestClient(create_app(self.path, {"recipe-bot": TOKEN})) as restarted:
            response = restarted.get(URL)
            self.assertEqual(response.json()["payload"], update()["payload"])
            self.assertEqual(response.headers["cache-control"], "no-store")

    def test_recipe_payload_without_automatic_is_accepted(self):
        payload = update()
        del payload["payload"]["automatic"]
        self.assertEqual(self.client.put(URL, json=payload, headers=self.auth).json(), {"applied": True})

    def test_concurrent_updates_keep_newest(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda day: self.client.put(URL, json=update(day), headers=self.auth),
                                      [25, 20, 23, 21, 27, 24]))
        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertEqual(self.client.get(URL).json()["payload"]["recipe"]["id"], 27)

    def test_normalized_timezones(self):
        first = update()
        first["updated_at"] = "2026-09-21T10:00:00+02:00"
        self.client.put(URL, json=first, headers=self.auth)
        self.assertEqual(self.client.put(URL, json=update(), headers=self.auth).json(), {"applied": False})

    def test_invalid_payload(self):
        for body in ({}, {"updated_at": "2026-09-21T08:00:00", "payload": {}},
                     {"updated_at": "2026-09-21T08:00:00Z", "payload": {}},
                     {**update(), "extra": True}):
            with self.subTest(body=body):
                self.assertEqual(self.client.put(URL, json=body, headers=self.auth).status_code, 400)

    def test_other_bot_can_store_generic_state(self):
        url = "/api/v1/state/weather-bot/current-weather"
        data = {"updated_at": "2026-09-21T08:00:00Z", "payload": {"temperature": 20}}
        self.assertEqual(self.client.put(url, json=data, headers={
            "Authorization": "Bearer " + "w" * 40
        }).status_code, 200)
        self.assertEqual(self.client.get(url).json()["payload"], data["payload"])

    def test_household_tasks_are_validated_and_isolated(self):
        self.assertEqual(self.client.put(TASKS_URL, json=tasks_update(), headers=self.auth).status_code, 403)
        self.assertEqual(self.client.put(TASKS_URL, json=tasks_update(), headers=self.household_auth).status_code,
                         200)
        self.assertEqual(self.client.get(TASKS_URL).json()["payload"], tasks_update()["payload"])

    def test_household_agent_other_keys_remain_generic(self):
        url = "/api/v1/state/household-agent/preferences"
        data = {"updated_at": "2026-09-21T08:00:00Z", "payload": {"theme": "green"}}
        self.assertEqual(self.client.put(url, json=data, headers=self.household_auth).status_code, 200)
        self.assertEqual(self.client.get(url).json()["payload"], data["payload"])

    def test_invalid_household_tasks_payload(self):
        invalid_residents = [
            [],
            [{"id": "alex", "name": "Alex", "off_day": False, "tasks": ["Vacuum"]},
             {"id": "alex", "name": "Sam", "off_day": False, "tasks": ["Cook"]}],
            [{"id": "alex", "name": " ", "off_day": False, "tasks": ["Vacuum"]}],
            [{"id": "alex", "name": "Alex", "off_day": False, "tasks": [""]}],
            [{"id": "alex", "name": "Alex", "off_day": True, "tasks": ["Vacuum"]}],
        ]
        for residents in invalid_residents:
            with self.subTest(residents=residents):
                self.assertEqual(self.client.put(TASKS_URL, json=tasks_update(residents),
                                                 headers=self.household_auth).status_code, 400)

    def test_health(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main()

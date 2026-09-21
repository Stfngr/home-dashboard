# Home Dashboard

Eigenständige Website für den aktuellen Zustand deiner Bots. FastAPI speichert
pro `(source, key)` nur den neuesten Zustand in SQLite. Caddy liefert eine
responsive HTML/CSS/JS-Website aus. Das ausgewählte Rezept bleibt auch nach
Mitternacht sichtbar. Der Browser fragt alle 15 Sekunden nach Änderungen.

Keine Abhängigkeit von RecipesAgent-Dateien, dessen Python-Modulen oder Telegram.
Weitere Bots können dieselbe API verwenden; ihre Anzeigen lassen sich später als
weitere Bereiche der Website ergänzen.

## Auf dem Raspberry Pi starten

Voraussetzungen: Docker Engine mit Compose-Plugin, Internetzugang für den ersten
Build. Die Images unterstützen ARM64. Projektordner auf den Pi übertragen und
die folgenden Befehle im Verzeichnis `home-dashboard` ausführen.

```bash
cp .env.example .env
chmod 600 .env
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

Den generierten Token als `HOME_DASHBOARD_RECIPE_TOKEN` in `.env` eintragen.
`HOME_DASHBOARD_PORT` ist standardmäßig `80`; wenn belegt, z. B. `8080` verwenden.

Gemeinsames Netzwerk einmal anlegen, dann starten:

```bash
docker network inspect bot-network >/dev/null 2>&1 || docker network create bot-network
docker compose up -d --build
docker compose ps
docker compose logs --tail=100
```

Website öffnen: `http://<pi-ip>/`, bei anderem Port `http://<pi-ip>:8080/`.
Nur Web-Port wird veröffentlicht. Caddy erlaubt über `/api/*` ausschließlich
lesende Zugriffe. Schreibzugriffe gehen direkt an `home-dashboard-api:8000`
im Docker-Netzwerk und benötigen einen Bot-Token.

Für den Heimnetzbetrieb keine Router-Portweiterleitung einrichten. Bei späterem
externem Zugriff HTTPS und Zugriffsrechte für das Dashboard ergänzen. Bilder
werden vom Browser direkt von der jeweiligen Rezeptquelle geladen.

## Recipe Bot verbinden

Bot-Version mit Dashboard-Unterstützung bauen bzw. installieren. In seiner
Umgebungsdatei `/etc/recipe-bot/.env` setzen:

```env
DASHBOARD_URL="http://home-dashboard-api:8000"
DASHBOARD_TOKEN="derselbe-token-wie-HOME_DASHBOARD_RECIPE_TOKEN"
```

Bot-Container neu erstellen: Zum bisherigen `docker run`-Befehl
`--network bot-network` hinzufügen, dieselben Konfigurations- und State-Mounts
verwenden. Ein Neustart allein lädt geänderte `--env-file`-Werte nicht neu.
Der Dashboard-Hostname wird durch Docker DNS aufgelöst.

Ab der nächsten manuellen oder automatischen Rezeptauswahl wird ein Snapshot
übertragen. Kein rückwirkender Import vorhandener Auswahlen. `!bot 0`, neue
Menüs und Restesonntage ersetzen das zuletzt ausgewählte Rezept nicht.
Der Bot speichert ausstehende Übertragungen dauerhaft und wiederholt Fehler,
ohne Telegram zu blockieren. Neue Auswahlen ersetzen ältere offene Übertragungen.

## API-Vertrag

```text
PUT /api/v1/state/{source}/{key}   Authorization: Bearer <token>
GET /api/v1/state/{source}/{key}   öffentlich lesend im Heimnetz
GET /health                      interner Healthcheck
```

Namen: Kleinbuchstaben, Ziffern und Bindestriche, maximal 64 Zeichen.
Für Rezepte: `recipe-bot/current-recipe`.

```json
{
  "updated_at": "2026-09-21T08:13:22.000000+00:00",
  "payload": {
    "date": "2026-09-21",
    "automatic": false,
    "recipe": {
      "id": 123,
      "title": "Pasta Primavera",
      "ingredients": ["200 g Pasta", "Gemüse"],
      "instructions": ["Pasta kochen.", "Mit Gemüse mischen."],
      "servings": 2,
      "ready_minutes": 30,
      "image_url": "https://example.com/recipe.jpg",
      "source_url": "https://example.com/recipe"
    }
  }
}
```

`updated_at` muss eine Zeitzone enthalten. Die API normalisiert auf UTC und
ersetzt den gespeicherten Zustand atomar nur bei einem neueren Zeitstempel.
Gleiche oder ältere Updates erhalten `200 {"applied": false}`; neue Updates
`200 {"applied": true}`. Bei gleichem Zeitstempel gewinnt das erste Update.
Bot-Uhren synchronisieren; Zeitstempel bilden die Reihenfolge ab.

GET liefert `source`, `key`, `updated_at` und `payload`; ohne Daten `404`.
Ungültige Anfragen liefern `400`, fehlende/falsche Tokens `401`, ein gültiger
Token für eine fremde Quelle `403`. Rezept-Payloads werden zusätzlich validiert;
andere Schlüssel akzeptieren beliebige JSON-Objekte bis 256 KB serialisiert.

Weitere Bots konfigurieren: `HOME_DASHBOARD_TOKENS` im API-Service ist ein
JSON-Objekt `{ "source": "token" }`. Jeder Token muss eindeutig sein und
mindestens 32 ASCII-Zeichen ohne Leerraum enthalten. Ergänze z. B. einen aus
einer separaten Umgebungsvariable eingesetzten `weather-bot`-Token. Tokens
gehören nie in Website-Code.

## Betrieb und Daten

```bash
docker compose logs -f
docker compose up -d --build
docker compose stop
docker compose start
```

SQLite liegt im benannten Volume `home-dashboard_dashboard-data` unter
`/data/dashboard.sqlite`. Es gibt keine Historie. Das Volume bleibt bei
Container-Neuerstellung erhalten. `docker compose down -v` löscht die Daten.
Für Dateibackups API stoppen und das gesamte Volume einschließlich möglicher
SQLite-WAL-Dateien sichern. Keine Bot-Dateien mit diesem Volume teilen.

## Lokal entwickeln und testen

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/python -m unittest discover -s tests -v
node --test tests/web.test.js
```

Nach `docker compose build` prüft `python3 tests/smoke_docker.py` die echten
Container einschließlich Caddy und Datenpersistenz. Der Test erstellt temporäre
Container, ein Netzwerk und ein Volume und entfernt sie anschließend wieder.

API lokal starten (Beispieltoken nur zur Entwicklung):

```bash
HOME_DASHBOARD_DB=./dashboard.sqlite \
HOME_DASHBOARD_TOKENS='{"recipe-bot":"local-development-token-at-least-32-chars"}' \
.venv/bin/uvicorn home_dashboard.api:create_app --factory --host 127.0.0.1 --port 8000
```

Website-Dateien liegen in `web/`. Kein Node-Build und keine externen
JavaScript-Abhängigkeiten erforderlich. Node wird nur für UI-Logiktests benutzt.
Die API-Tests prüfen Authentifizierung, Isolation, Persistenz, parallele und
verspätete Updates; UI-Tests prüfen Leerzustand, Polling und Fehlerverhalten.

# Home Dashboard

[English below](#english)

Eigenständige Website für den aktuellen Zustand deiner Bots.

## Überblick

FastAPI speichert pro `(source, key)` nur den neuesten Zustand in SQLite. Caddy
liefert eine responsive HTML/CSS/JS-Website aus. Das ausgewählte Rezept bleibt
über Mitternacht sichtbar. Der Browser fragt alle 15 Sekunden nach Änderungen.
Weitere Bots können dieselbe API verwenden; ihre Anzeigen lassen sich später als
weitere Bereiche ergänzen. Es gibt keine Abhängigkeit von RecipesAgent-Dateien,
dessen Python-Modulen oder Telegram.

## Voraussetzungen

Unterstützt wird ein Linux-Host mit ARM64-Architektur. Veröffentlicht werden
`linux/arm64`-Images; Docker mit Compose-Plugin ist der offizielle Betriebsweg.

## Lokale Entwicklung und Tests

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/python -m unittest discover -s tests -v
node --test tests/web.test.js
```

Nach `docker compose build` prüft `python3 tests/smoke_docker.py` echte Container
einschließlich Caddy und Datenpersistenz.

## Konfiguration

`.env` enthält `HOME_DASHBOARD_RECIPE_TOKEN`, optional `HOME_DASHBOARD_PORT` und
für Rollbacks `HOME_DASHBOARD_IMAGE_TAG`. Tokens gehören nie in Website-Code.

## Deployment mit Docker

Voraussetzungen: Linux-Host mit ARM64-Architektur und Docker Engine mit
Compose-Plugin. Veröffentlicht werden `linux/arm64`-Images; lokales Bauen bleibt
für Entwicklung möglich. Nach
jedem Push auf `main` prüft GitHub Actions API, Website und Docker-Integration
und veröffentlicht beide Container:

```text
ghcr.io/stfngr/home-dashboard-api:latest
ghcr.io/stfngr/home-dashboard-api:main
ghcr.io/stfngr/home-dashboard-api:sha-<commit>
ghcr.io/stfngr/home-dashboard-web:latest
ghcr.io/stfngr/home-dashboard-web:main
ghcr.io/stfngr/home-dashboard-web:sha-<commit>
```

Nach dem ersten Workflow-Lauf in GitHub unter **Packages** beide Packages auf
**Public** setzen. Sonst benötigt der Host GitHub-Zugangsdaten zum Pullen.

```bash
cp .env.example .env
chmod 600 .env
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

Den generierten Token als `HOME_DASHBOARD_RECIPE_TOKEN` in `.env` eintragen.
`HOME_DASHBOARD_PORT` ist standardmäßig `80`; wenn belegt, z. B. `8080` verwenden.

Gemeinsames Netzwerk einmal anlegen, dann veröffentlichte Images starten:

```bash
docker network inspect bot-network >/dev/null 2>&1 || docker network create bot-network
docker compose -f compose.yml -f compose.production.yml pull
docker compose -f compose.yml -f compose.production.yml up -d
docker compose -f compose.yml -f compose.production.yml ps
docker compose -f compose.yml -f compose.production.yml logs --tail=100
```

Lokal entwickeln oder vor dem ersten CI-Image bauen:

```bash
docker compose up -d --build
```

Website öffnen: `http://<host-ip>/`, bei anderem Port `http://<host-ip>:8080/`.
Nur Web-Port wird veröffentlicht. Caddy erlaubt über `/api/*` ausschließlich
lesende Zugriffe. Schreibzugriffe gehen direkt an `home-dashboard-api:8000`
im Docker-Netzwerk und benötigen einen Bot-Token.

Für den Heimnetzbetrieb keine Router-Portweiterleitung einrichten. Bei späterem
externem Zugriff HTTPS und Zugriffsrechte für das Dashboard ergänzen. Bilder
werden vom Browser direkt von der jeweiligen Rezeptquelle geladen.

### Aktualisieren und Rollback

Ein Update lädt beide neuesten Images und erstellt Container bei Bedarf neu;
SQLite-Volume und Docker-Netzwerk bleiben erhalten:

```bash
docker compose -f compose.yml -f compose.production.yml pull
docker compose -f compose.yml -f compose.production.yml up -d
```

Für ein gezieltes Rollback dieselbe SHA-Version für API und Website verwenden:

```bash
HOME_DASHBOARD_IMAGE_TAG=sha-<commit> \
  docker compose -f compose.yml -f compose.production.yml up -d
```

`latest` und `main` werden nur vom Build aktualisiert, dessen Commit beim
abschließenden CI-Check noch `main` entspricht. Ältere Workflow-Läufe erzeugen
allenfalls ihren unveränderlichen SHA-Tag. API und Website immer mit demselben
Tag ausrollen.

## Integrationen

### Recipe Bot

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

## English

Independent website for current bot state.

## Overview

FastAPI stores only the latest state for each `(source, key)` in SQLite. Caddy
serves responsive HTML, CSS, and JavaScript. The selected recipe remains visible
past midnight. The browser polls every 15 seconds. Additional bots can use the
same API and gain their own views later. This project does not depend on
RecipesAgent files, Python modules, or Telegram.

## Requirements

Requires Linux ARM64 host. Published images are `linux/arm64`; Docker Engine with
Compose plugin is the supported runtime.

## Local Development And Tests

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/python -m unittest discover -s tests -v
node --test tests/web.test.js
```

After `docker compose build`, `python3 tests/smoke_docker.py` validates actual
containers including Caddy and persisted state.

## Configuration

`.env` contains `HOME_DASHBOARD_RECIPE_TOKEN`, optional `HOME_DASHBOARD_PORT`,
and `HOME_DASHBOARD_IMAGE_TAG` for rollback. Never put tokens in website code.

## Deployment With Docker

Each push to `main` runs API, UI, and Docker integration checks in GitHub Actions,
then publishes:

```text
ghcr.io/stfngr/home-dashboard-api:latest
ghcr.io/stfngr/home-dashboard-api:main
ghcr.io/stfngr/home-dashboard-api:sha-<commit>
ghcr.io/stfngr/home-dashboard-web:latest
ghcr.io/stfngr/home-dashboard-web:main
ghcr.io/stfngr/home-dashboard-web:sha-<commit>
```

After the first workflow run, open both GitHub **Packages** pages and make the
packages **Public**, otherwise the host needs GitHub credentials to pull them.

Copy the project folder to the host, then run these commands in `home-dashboard`:

```bash
cp .env.example .env
chmod 600 .env
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

Put the generated value into `HOME_DASHBOARD_RECIPE_TOKEN` in `.env`.
`HOME_DASHBOARD_PORT` defaults to `80`; choose e.g. `8080` if occupied.

Create shared Docker network once, then start published images:

```bash
docker network inspect bot-network >/dev/null 2>&1 || docker network create bot-network
docker compose -f compose.yml -f compose.production.yml pull
docker compose -f compose.yml -f compose.production.yml up -d
docker compose -f compose.yml -f compose.production.yml ps
docker compose -f compose.yml -f compose.production.yml logs --tail=100
```

For local development or a local build before first CI images exist:

```bash
docker compose up -d --build
```

Open `http://<host-ip>/`, or `http://<host-ip>:8080/` with another port. Only the
web port is published. Caddy allows only read access under `/api/*`. Writes go
directly to `home-dashboard-api:8000` in the Docker network and need a bot token.

Do not configure router port forwarding for LAN use. Add HTTPS and access control
before exposing the dashboard externally. Browsers load recipe images directly
from each recipe source.

### Update And Roll Back

Update pulls both latest images and recreates containers as needed; the SQLite
volume and Docker network remain intact:

```bash
docker compose -f compose.yml -f compose.production.yml pull
docker compose -f compose.yml -f compose.production.yml up -d
```

For a targeted rollback, use the same immutable SHA tag for API and web:

```bash
HOME_DASHBOARD_IMAGE_TAG=sha-<commit> \
  docker compose -f compose.yml -f compose.production.yml up -d
```

`latest` and `main` are promoted only by a build whose commit still matches
`main` at the final CI check. Older workflow runs may publish their immutable
SHA tag only. Always deploy API and web with the same tag.

## Integrations

### Recipe Bot

Build or install the Recipe Bot version with dashboard support. Set these values
in `/etc/recipe-bot/.env`:

```env
DASHBOARD_URL="http://home-dashboard-api:8000"
DASHBOARD_TOKEN="same-token-as-HOME_DASHBOARD_RECIPE_TOKEN"
```

Recreate the bot container with `--network bot-network` added to its existing
`docker run` command, retaining the same configuration and state mounts. A
restart alone does not reload changed `--env-file` values. Docker DNS resolves
the dashboard hostname.

The next manual or automatic selection sends a recipe snapshot. There is no
backfill of prior selections. `!bot 0`, new menus, and leftovers Sundays do not
replace the previously selected recipe. The bot persists pending updates and
retries failures without blocking Telegram. A newer selection replaces an older
pending update.

## API Contract

```text
PUT /api/v1/state/{source}/{key}   Authorization: Bearer <token>
GET /api/v1/state/{source}/{key}   public read-only on LAN
GET /health                        internal health check
```

Names use lowercase letters, digits, and hyphens, up to 64 characters. Recipes
use `recipe-bot/current-recipe`.

```json
{
  "updated_at": "2026-09-21T08:13:22.000000+00:00",
  "payload": {
    "date": "2026-09-21",
    "automatic": false,
    "recipe": {
      "id": 123,
      "title": "Pasta Primavera",
      "ingredients": ["200 g pasta", "vegetables"],
      "instructions": ["Cook pasta.", "Combine with vegetables."],
      "servings": 2,
      "ready_minutes": 30,
      "image_url": "https://example.com/recipe.jpg",
      "source_url": "https://example.com/recipe"
    }
  }
}
```

`updated_at` must contain a timezone. The API normalizes to UTC and atomically
replaces stored state only for a newer timestamp. Equal or older updates return
`200 {"applied": false}`; newer updates return `200 {"applied": true}`. The
first update wins at equal timestamps. Synchronize bot clocks; timestamps define
ordering.

GET returns `source`, `key`, `updated_at`, and `payload`; it returns `404` before
first state. Invalid requests return `400`, missing/invalid tokens `401`, and a
valid token attempting another source `403`. Recipe payloads receive extra
validation; other keys accept arbitrary serialized JSON objects up to 256 KB.

To add bots, configure `HOME_DASHBOARD_TOKENS` for API with a JSON object such
as `{ "source": "token" }`. Tokens must be unique ASCII strings of at least
32 non-whitespace characters. Add e.g. `weather-bot` token from a separate
environment variable. Never put tokens in website code.

## Operations And Data

```bash
docker compose logs -f
docker compose up -d --build
docker compose stop
docker compose start
```

SQLite lives in named volume `home-dashboard_dashboard-data` at
`/data/dashboard.sqlite`. There is no history. The volume survives container
recreation; `docker compose down -v` deletes data. For file backups, stop API
and back up the complete volume including possible SQLite WAL files. Never share
this volume with bots.

Start API locally (example development token only):

```bash
HOME_DASHBOARD_DB=./dashboard.sqlite \
HOME_DASHBOARD_TOKENS='{"recipe-bot":"local-development-token-at-least-32-chars"}' \
.venv/bin/uvicorn home_dashboard.api:create_app --factory --host 127.0.0.1 --port 8000
```

Website files are in `web/`. No Node build or external JavaScript dependencies
are required. Node is used only for UI logic tests. API tests cover
authentication, isolation, persistence, concurrent and delayed updates; UI tests
cover empty state, polling, and failure behavior.

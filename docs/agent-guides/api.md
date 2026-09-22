# API and State Contract

Use for FastAPI endpoints, SQLite persistence, authentication, or state payload changes.

## Location

- API implementation: `src/home_dashboard/api.py`
- API tests: `tests/test_api.py`

## Contract

- `PUT /api/v1/state/{source}/{key}` requires a bearer token. A token may write only its configured source.
- `GET /api/v1/state/{source}/{key}` is read-only and returns `404` when no state exists.
- `GET /health` is an internal health check.
- `source` and `key` must match `^[a-z0-9][a-z0-9-]{0,63}$`.
- State updates include timezone-aware `updated_at`. Normalize to UTC and atomically retain only strictly newer updates.
- Equal or older writes return `200 {"applied": false}` so clients can retire retries.
- Generic payloads must be JSON objects no larger than 256 KB serialized.

## Known Payloads

- `recipe-bot/current-recipe`: validate recipe payload.
- `household-agent/current-tasks`: validate household-task payload.
- Other source/key pairs accept generic payloads.

Keep validation and tests synchronized whenever a known payload changes.

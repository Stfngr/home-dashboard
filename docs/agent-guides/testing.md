# Testing

Use when changing behavior or validating work.

## Commands

```bash
.venv/bin/python -m unittest discover -s tests -v
node --test tests/web.test.js
```

For Docker integration after `docker compose build`:

```bash
python3 tests/smoke_docker.py
```

## Coverage Expectations

- API changes: cover authentication, source isolation, validation, persistence, and timestamp ordering where applicable.
- Web changes: cover empty states, polling, failure handling, accessibility behavior, and URL safety where applicable.
- Docker or proxy changes: run smoke test when Docker available.

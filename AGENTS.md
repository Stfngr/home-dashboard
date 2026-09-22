# Home Dashboard

FastAPI service and static dashboard for latest recipe and household-task bot state, backed by SQLite and deployed with Docker.

Requires Python 3.11+. Install test dependencies with `.venv/bin/pip install -e '.[test]'`.

Run relevant checks before finishing:

```bash
.venv/bin/python -m unittest discover -s tests -v
node --test tests/web.test.js
```

Load task-specific guidance only when relevant:

- [API and State Contract](docs/agent-guides/api.md)
- [Web Dashboard](docs/agent-guides/web.md)
- [Testing](docs/agent-guides/testing.md)
- [Docker and Deployment](docs/agent-guides/operations.md)
- [Security and Configuration](docs/agent-guides/security.md)

# Docker and Deployment

Use for Dockerfiles, Compose files, CI/CD, runtime configuration, or release behavior.

## Runtime

- Supported deployment target: Linux ARM64 with Docker Engine Compose plugin.
- Local development uses `docker compose up -d --build`.
- Production pulls `ghcr.io/stfngr/home-dashboard-api` and `ghcr.io/stfngr/home-dashboard-web` using matching image tags from `compose.production.yml`.
- API SQLite data is persisted in named `dashboard-data` volume. Do not remove it accidentally; `docker compose down -v` deletes state.
- Services share external `bot-network`. Only web port is published; bot writes occur directly to API over Docker network.

## Release

- Pushes to `main` publish API and web images plus GitHub Pages demo.
- Deploy API and web using same immutable SHA tag for rollback consistency.

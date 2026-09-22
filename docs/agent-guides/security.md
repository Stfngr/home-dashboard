# Security and Configuration

Use for authentication, secrets, networking, demo content, or environment variables.

## Secrets

- Keep tokens out of website code, demo assets, committed files, logs, and error messages.
- Configure source-to-token mapping with `HOME_DASHBOARD_TOKENS`; production Compose derives it from `HOME_DASHBOARD_RECIPE_TOKEN` and `HOME_DASHBOARD_HOUSEHOLD_TOKEN`.
- Tokens must be unique ASCII strings at least 32 characters long and contain no whitespace.
- Keep `.env` permission-restricted and untracked.

## Network Exposure

- Caddy exposes only read access beneath `/api/*`; writes require direct API access from `bot-network` plus bearer authentication.
- Do not add router port forwarding for LAN deployment.
- Require HTTPS and access control before any external exposure.

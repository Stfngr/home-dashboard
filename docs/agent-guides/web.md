# Web Dashboard

Use for files in `web/`, `pages/`, and browser behavior.

## Constraints

- Website is static HTML, CSS, and JavaScript. No Node build or external JavaScript dependencies.
- Node exists only to run `tests/web.test.js`.
- Production uses `web/dashboard-config.json` with live API paths.
- GitHub Pages replaces dashboard configuration with `pages/dashboard-config.json` and serves only fixed demo data from `pages/`.
- Keep production and demo paths separate. Demo must never access LAN API or contain tokens.

## Behavior

- Recipe and household-task states poll independently every 15 seconds.
- On fetch failure, retain current rendered state and show status instead of clearing it.
- Render remote text with DOM text APIs, not HTML injection.
- Allow external recipe image and source URLs only for `http:` and `https:`.
- Preserve accessible tabs: `aria-selected`, focus movement with left/right arrows, and hidden inactive panel.

Add or update `tests/web.test.js` for UI behavior changes.

# MarathonIndia

[![Weekly race fetch](https://github.com/puneafterhours/marathonindia/actions/workflows/fetch.yml/badge.svg)](https://github.com/puneafterhours/marathonindia/actions/workflows/fetch.yml)

India's running race calendar. Static site: `index.html` + `styles.css` + `app.js` + `races.json`. No build step, no backend, no tracking.

- Pune-first default view with an All India toggle, state / city / distance filters, certified-only filter, and search.
- Every race card carries its certification evidence (AIMS member / WA Label / WA course cert with expiry / ITRA) and its own last-checked date. No blanket verified badge.
- Fees, GST treatment and entry requirements are never guessed: cards point to the registration page until an update cycle has captured them from the organiser.

## Data

`races.json` is the whole data layer. Current seed: 28 races extracted 11 Nov 2026 from the live punerunners.com race calendar (its per-race cert tags and last-checked dates carried over unchanged). Scope `pune` / `near-pune` powers the Pune-first view.

Fields per race: `id, name, city, state, dateText, month, scope, distances[], url, certification, lastChecked, note, hasDiscount, source`.

## Deploy (once the account setup is confirmed)

Static hosting on Vercel: push this folder to the GitHub repo, import in Vercel as a static project, set the chosen subdomain. No framework preset needed.

## Update flow - see UPDATING.md

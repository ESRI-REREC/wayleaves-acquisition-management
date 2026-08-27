# Wayleave Acquisition Management

UI screens for managing wayleave acquisition projects for REREC, built with the
[Calcite Design System](https://developers.arcgis.com/calcite-design-system/) and
the [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/)
(map components). Plain HTML, CSS and JS — no framework, no build step.

Backend activities (writes, corridor generation) will go through the Next.js
server in [`../server`](../server).

```
index.html    Projects list — <arcgis-feature-table>
projects.js   loads the Projects table, row → details navigation
project.html  Project details — title, reference no., 3 tabs
project.js    loads one project, fills Overview + corridor map
config.js     URLs, token server, table/overview columns   <-- edit this
auth.js       shared token handling (mint + register with the SDK)
styles.css    layout
```

## Screens

**Projects list (`index.html`)** — the `Projects` hosted table rendered in an
`arcgis-feature-table`. Each row is clickable and the last cell shows a
`launch` icon; either opens **`project.html?oid=<objectid>`**.

**Project details (`project.html`)** — the project **name** as the title with
the **reference number** beneath it, a status chip, and three tabs:

- **Overview** — the project's attributes (reference number, implementation
  status, funding year, initiator category, funding category).
- **Route & Corridor Map** — an imagery map centred on the project area with a
  **Generate Corridor** button. The route, corridor and parcels are placeholders
  until the backend is wired up.
- **Affected Parcels** — empty state until corridor generation is implemented.

## Running it

Serve over HTTP (not `file://` — a `file://` origin cannot get a valid token).

```powershell
python -m http.server 3000
```

Then open <http://localhost:3000>.

**Important — the origin must match the token's referer.** The token server
mints a *referer-bound* token. The deployed server in `config.js`
(`dev-server-rerec-poc.vercel.app`) is bound to `http://localhost:3000`, so the
pages must be served from `http://localhost:3000` for the secured table to load.
If you run your own token server (`../server`), set its `ARCGIS_REFERER` and
`ALLOWED_ORIGINS` to whatever origin you serve these pages from, and point
`config.js` → `serverUrl` at it.

## Configuration

Everything environment-specific is in `config.js`:

- **`serverUrl`** — the token server. Swap for your local Next.js server
  (`http://localhost:3000`) when running the backend yourself.
- **`projectsLayerUrl`** — the Projects `FeatureServer/0` table.
- **`basemap`** — imagery (`hybrid`) by default to match the design; or
  `portal-default`, `topo-vector`, `satellite`, etc.
- **`projectColumns`** — which fields the table shows, and in what order.
- **`overviewFields`** — which fields the Overview tab lists.

## Notes

- **No credentials in the browser.** `auth.js` fetches a short-lived token from
  the server's `GET /api/token`; the username and password stay on the server.
- **Row navigation** is driven by the table's `arcgisCellClick` event, so it
  works whether the user clicks a cell or the injected launch icon. The icon is
  injected into the table's shadow DOM as a visual affordance and is guarded —
  if the component's internal markup changes, the row click still works.
- **Versions** — pinned to ArcGIS Maps SDK `4.31`, map components `4.31`, and
  Calcite `2.13.2` (a compatible set). Bump them together.
- The `Projects` layer is a **non-spatial table**, so the list has no map; the
  corridor map on the details page is a standalone imagery map.
```

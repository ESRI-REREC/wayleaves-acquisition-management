# Wayleave corridor geoprocessing tool

`generate_wayleave_corridor.py` builds a wayleave corridor for one project from
its design route lines, writes it to the **Wayleave Corridors** layer, and
stamps every **Parcel** the corridor crosses with the corridor id.

## What it reads / writes

| Role | Layer | Key fields |
|---|---|---|
| Route lines — 1-Φ LV (**240 V**) | Survey_and_Design_Assets **/13** | `reference_number` |
| Route lines — 3-Φ LV (**415 V**) | Survey_and_Design_Assets **/14** | `reference_number` |
| Route lines — HT (**per-feature**) | Survey_and_Design_Assets **/1** | `reference_number`, `voltage_level` |
| Width rules | Wayleaves **/3** | `voltage_level` (code: `240`,`415`,`11000`,`33000`,…), `width` (total m) |
| Output corridor | Wayleaves **/1** | `reference_number` = `wayleave_id` = `<ref>`, `generation_date` |
| Affected parcels | Wayleaves **/0** | `wayleave_id` (`;`-separated list of refs), `acquisition_status` |

The three route layers are fixed in the `ROUTE_SOURCES` list at the top of the
script (LV layers carry a constant voltage; HT lines use their `voltage_level`
field). `width` is the **total** corridor width; the tool buffers by `width / 2`
each side, GEODESIC (true metres). The four seeded rules are `240→5`, `415→5`,
`11000→6`, `33000→10` m — **confirm against your KPLC/REREC standard.**

## Logic (per run)

1. Resolve each line's half-width from its voltage (via the rules table).
2. Buffer + dissolve all of the project's lines into **one** corridor polygon.
3. Write the corridor with `reference_number = wayleave_id = <ref>`.
4. Select parcels intersecting the corridor, **append** `<ref>` to their
   `wayleave_id` list, and seed `acquisition_status = "Not acquired"` when a
   parcel first becomes affected.

Re-running for the same `reference_number` is **idempotent**: it first clears the
project's previous corridor and removes `<ref>` from its parcels' `wayleave_id`
(clearing `acquisition_status` only for parcels left in no corridor).

## Build the script tool (ArcGIS Pro)

1. In a toolbox: **Add → Script**, point it at `generate_wayleave_corridor.py`.
2. Add the parameters exactly as in the script's docstring:
   `reference_number` (String, required), `rules_table` (Table, optional),
   `corridor_layer` (Feature Layer, optional), `parcels_layer` (Feature Layer,
   optional), `half_width_override_m` (Double, optional),
   `corridors_written` (Long, Output), `affected_parcels` (Long, Output),
   `out_corridor` (Feature Set, Output).
3. Run once with a real reference to validate (it edits Wayleaves /1 and /0).

## Publish it as a Web Tool (host it)

1. From the Geoprocessing history, right-click the successful run →
   **Share As → Web Tool**.
2. Publish to your **federated server** (`development.esriea.com/server`) — needs
   the **Geoprocessing** capability. Choose **asynchronous**, Message Level = Info.
3. Publish the layer inputs **by reference** (server reads the hosted services
   live), not copied.
4. Share the GP service to the org/group that owns the Wayleaves + Assets
   services so the server identity can **read the routes/rules and edit the
   corridor + parcels layers**. If edits fail, run it under an account with edit
   rights or register the data store.

Result URL:
`…/server/rest/services/<Folder>/GenerateWayleaveCorridor/GPServer/GenerateWayleaveCorridor`

## Call it from the web app

Add the GP URL to `config.js` (e.g. `corridorGpUrl`) and replace the Generate
Corridor placeholder in `project.js`:

```js
import * as geoprocessor from "https://js.arcgis.com/4.31/@arcgis/core/rest/geoprocessor.js";

const job = await geoprocessor.submitJob(CFG.corridorGpUrl, {
  reference_number: attrs.project_reference_number
});
await job.waitForJobCompletion();
const { value } = await job.fetchResultData("out_corridor"); // FeatureSet
// add `value` to the corridor map; affected parcels now list this reference in
// wayleave_id, so query Wayleaves/0 where wayleave_id LIKE '%<ref>%' and group
// by acquisition_status for the panel counts.
```

The officer is signed in (OAuth), so the SDK attaches their token to the GP
call automatically.

## Affected-parcels panel

Affected parcels carry `acquisition_status` (seeded `"Not acquired"`) and this
project's reference in their `wayleave_id` list. To fill the panel, query
Wayleaves/0 where `wayleave_id LIKE '%<ref>%'` and group by `acquisition_status`
(Not acquired / Acquired / Pending consent signing / Acquisition failed);
officers update the status as parcels progress. Say the word and I'll wire the
panel counts + the corridor draw into `project.js`.

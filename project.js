/* ---------------------------------------------------------------------------
 * project.js — Project details screen (ES module).
 *
 * Reads ?oid=<objectid> from the URL, queries that project from the secured
 * Projects table, and fills the title / reference number / Overview tab. The
 * Wayleave Corridor tab shows an imagery map; until a corridor is generated it
 * displays all parcels from the Wayleaves parcels layer, framed to their
 * extent. Corridor generation is a placeholder until the backend is wired up.
 * ------------------------------------------------------------------------- */

import esriConfig from "https://js.arcgis.com/4.31/@arcgis/core/config.js";
import FeatureLayer from "https://js.arcgis.com/4.31/@arcgis/core/layers/FeatureLayer.js";
import GroupLayer from "https://js.arcgis.com/4.31/@arcgis/core/layers/GroupLayer.js";
import Graphic from "https://js.arcgis.com/4.31/@arcgis/core/Graphic.js";
import Extent from "https://js.arcgis.com/4.31/@arcgis/core/geometry/Extent.js";
import { ensureSignedIn, getServerToken } from "./oauth.js";

const CFG = window.APP_CONFIG;
const $ = (id) => document.getElementById(id);

/** Colour the status chip by implementation status. */
const STATUS_KIND = {
  completed: "success",
  ongoing: "brand",
  planning: "warning",
  "on hold": "warning",
  cancelled: "danger"
};

/* ------------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------------ */

function getOid() {
  const oid = new URLSearchParams(window.location.search).get("oid");
  return oid ? Number(oid) : null;
}

/* field name -> esri field type, captured from the layer so we can format
 * date fields in the Overview panels. */
const fieldTypes = {};

async function fetchProject(oid) {
  const layer = new FeatureLayer({
    url: CFG.projectsLayerUrl,
    outFields: ["*"]
  });
  await layer.load();
  layer.fields.forEach((f) => (fieldTypes[f.name] = f.type));

  const result = await layer.queryFeatures({
    objectIds: [oid],
    outFields: ["*"],
    returnGeometry: false
  });

  const feature = (result.features || [])[0];
  if (!feature) throw new Error("Project " + oid + " was not found.");
  return feature.attributes;
}

/* ------------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------------ */

function renderHeader(attrs) {
  $("project-title").textContent = attrs.project_name || "Untitled project";
  document.title =
    (attrs.project_name || "Project") + " · Wayleave Acquisition Management";

  const ref = attrs.project_reference_number;
  $("project-ref").textContent = ref ? "Ref: " + ref : "";

  const status = attrs.implementation_status;
  if (status) {
    const chip = $("status-chip");
    chip.textContent = status;
    chip.kind = STATUS_KIND[status.toLowerCase()] || "neutral";
    chip.hidden = false;
  }
}

/** Format one attribute for display: dates → readable, empties → em dash. */
function formatValue(value, field) {
  if (value == null || value === "") return "—";
  // JS SDK Field.type uses short forms, e.g. "date" (not "esriFieldTypeDate").
  if (["date", "date-only", "timestamp-offset"].includes(fieldTypes[field])) {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }
  return String(value);
}

/** Build one collapsible panel per config.overviewSections section. */
function renderOverview(attrs) {
  const container = $("overview-sections");
  container.innerHTML = "";

  CFG.overviewSections.forEach((section, idx) => {
    const block = document.createElement("calcite-block");
    block.setAttribute("heading", section.title);
    block.setAttribute("collapsible", "");
    // Only the first panel (Project Details) is expanded by default.
    if (idx === 0) block.setAttribute("open", "");
    if (section.icon) block.setAttribute("icon-start", section.icon);

    const dl = document.createElement("dl");
    dl.className = "detail-list";
    section.fields.forEach((f) => {
      const dt = document.createElement("dt");
      dt.textContent = f.label;
      const dd = document.createElement("dd");
      dd.textContent = formatValue(attrs[f.field], f.field);
      dl.appendChild(dt);
      dl.appendChild(dd);
    });

    block.appendChild(dl);
    container.appendChild(block);
  });
}

/** Add every Survey_and_Design_Assets sublayer to the map, grouped so the layer
 * list stays tidy. All layers render (visible) by default. */
async function loadAssetLayers(map) {
  const token = await getServerToken();
  const res = await fetch(
    CFG.assetsServiceUrl + "?f=json&token=" + encodeURIComponent(token)
  );
  const svc = await res.json();
  if (svc.error) throw new Error(svc.error.message || "Could not read asset layers.");

  const hiddenPrefixes = CFG.mapHiddenLayerPrefixes || [];
  const startsHidden = (name) => hiddenPrefixes.some((p) => String(name).startsWith(p));
  const group = new GroupLayer({
    title: "Survey & Design Assets",
    visibilityMode: "independent"
  });
  (svc.layers || []).forEach((l) => {
    // Load each sublayer FROM THE PORTAL ITEM (not the raw service url) so it
    // inherits the symbology saved on the item's visualization. Falls back to
    // the raw service url if no item id is configured.
    const props = CFG.assetsItemId
      ? { portalItem: { id: CFG.assetsItemId }, layerId: l.id }
      : { url: CFG.assetsServiceUrl + "/" + l.id };
    const layer = new FeatureLayer({
      ...props,
      title: l.name,
      // suggested_* and existing* layers start switched off (config prefixes).
      visible: !startsHidden(l.name),
      outFields: ["*"],
      popupEnabled: true
    });
    // Keep the item's configured popup if any; otherwise auto-generate one.
    layer
      .when(() => {
        if (!layer.popupTemplate) layer.popupTemplate = layer.createPopupTemplate();
      })
      .catch(() => {});
    group.add(layer);
  });
  map.add(group);
}

/** Zoom the map to the Facilities point whose reference_number matches the
 * project, dropping a marker there. Returns true if it framed a facility. */
async function centerOnFacility(view, ref) {
  if (!ref) return false;
  try {
    const facilities = new FeatureLayer({ url: CFG.facilitiesLayerUrl });
    await facilities.load();
    const result = await facilities.queryFeatures({
      where: `reference_number = '${ref.replace(/'/g, "''")}'`,
      outFields: ["objectid", "name"],
      returnGeometry: true,
      num: 1
    });
    const feature = (result.features || [])[0];
    if (!feature || !feature.geometry) return false;

    view.graphics.add(
      new Graphic({
        geometry: feature.geometry,
        symbol: {
          type: "simple-marker",
          style: "circle",
          size: 14,
          color: [0, 122, 194, 0.9],
          outline: { color: [255, 255, 255], width: 2 }
        }
      })
    );
    await view.goTo({ target: feature.geometry, zoom: CFG.mapFacilityZoom || 17 });
    return true;
  } catch (err) {
    return false;
  }
}

/** Populate the affected-parcels panel. Zeros until the parcels are loaded. */
function renderAcquisitionStats(stats) {
  const s = stats || { total: 0, notAcquired: 0, acquired: 0, pending: 0, failed: 0 };
  $("parcels-total").textContent = s.total;
  $("dist-not-acquired").textContent = s.notAcquired;
  $("dist-acquired").textContent = s.acquired;
  $("dist-pending").textContent = s.pending;
  $("dist-failed").textContent = s.failed;
}

/** acquisition_status value -> its distribution bucket (statuses match the GP
 * tool's seed + the panel's rows). */
const STATUS_BUCKET = {
  "not acquired": "notAcquired",
  "acquired": "acquired",
  "pending consent signing": "pending",
  "acquisition failed": "failed"
};

/** Query the parcels tagged with this project (the corridor GP tool appends the
 * reference to each affected parcel's wayleave_id list), then fill the
 * distribution panel and the Affected Parcels table. */
async function loadAffectedParcels(reference) {
  if (!reference) return;
  try {
    const layer = new FeatureLayer({ url: CFG.parcelsLayerUrl, outFields: ["*"] });
    await layer.load();
    const result = await layer.queryFeatures({
      where: `wayleave_id LIKE '%${reference.replace(/'/g, "''")}%'`,
      outFields: ["parcel_no", "lr_no", "acquisition_status", "wayleave_id"],
      returnGeometry: false
    });
    // wayleave_id is a ';'-separated list of references — keep exact members only
    // (so a LIKE substring hit on another reference can't leak in).
    const rows = (result.features || [])
      .map((f) => f.attributes)
      .filter((a) =>
        String(a.wayleave_id || "")
          .split(";")
          .map((s) => s.trim())
          .includes(reference)
      );
    renderAffectedParcels(rows);
  } catch (err) {
    alertUser("Affected parcels", err.message, "warning");
  }
}

/** Compute the acquisition distribution and render the table from the rows. */
function renderAffectedParcels(rows) {
  const stats = { total: rows.length, notAcquired: 0, acquired: 0, pending: 0, failed: 0 };
  rows.forEach((a) => {
    const bucket = STATUS_BUCKET[String(a.acquisition_status || "").trim().toLowerCase()];
    if (bucket) stats[bucket] += 1;
  });
  renderAcquisitionStats(stats);
}

/** Bind the Affected Parcels <arcgis-feature-table> to this project's parcels
 * (attachments on), with parcel_no / lr_no / acquisition_status columns. Row
 * click opens the parcel / ownership page. */
async function initParcelsTable(reference, projectOid) {
  const tableEl = $("parcels-table");
  if (!tableEl || !reference) return;
  await customElements.whenDefined("arcgis-feature-table");

  const layer = new FeatureLayer({
    url: CFG.parcelsLayerUrl,
    outFields: ["*"],
    definitionExpression: `wayleave_id LIKE '%${reference.replace(/'/g, "''")}%'`
  });
  await layer.load();

  tableEl.tableTemplate = {
    columnTemplates: [
      { type: "field", fieldName: "parcel_no", label: "Parcel No.", width: 220, autoWidth: false },
      { type: "field", fieldName: "lr_no", label: "LR No.", width: 200, autoWidth: false },
      { type: "field", fieldName: "acquisition_status", label: "Acquisition Status", width: 180, autoWidth: false }
    ]
  };
  tableEl.layer = layer;

  tableEl.addEventListener("arcgisCellClick", (event) => {
    const oid = objectIdFromCellEvent(event);
    if (oid == null) return;
    const params = new URLSearchParams({
      oid: String(oid),
      ref: reference,
      project: String(projectOid)
    });
    window.location.href = "parcel.html?" + params.toString();
  });
}

/** Pull the objectid out of a feature-table cell-click event (tolerant of API
 * shapes). */
function objectIdFromCellEvent(event) {
  const d = event.detail || {};
  const feature =
    d.feature || d.graphic || (d.item && d.item.feature) || (d.target && d.target.feature);
  if (feature && feature.attributes) {
    const a = feature.attributes;
    return a.objectid ?? a.OBJECTID ?? a.ObjectId ?? null;
  }
  return d.objectId != null ? d.objectId : null;
}

/** Show / hide the floating affected-parcels panel. */
function setCorridorPanelOpen(open) {
  if (open) $("corridor-panel").closed = false; // clear the panel's own close
  $("corridor-card").hidden = !open;
  $("corridor-reopen").hidden = open;
}

/** Wire the corridor panel: close/reopen + the Generate/Digitize buttons. */
function wireCorridorPanel() {
  $("corridor-panel").addEventListener("calcitePanelClose", () =>
    setCorridorPanelOpen(false)
  );
  $("corridor-reopen").addEventListener("click", () => setCorridorPanelOpen(true));

  $("generate-corridor-btn").addEventListener("click", () => {
    alertUser(
      "Not wired up yet",
      "Corridor generation will call the backend server.",
      "info"
    );
  });

  // Digitize parcels — open the configured feature item's overview page.
  $("digitize-parcels-btn").addEventListener("click", () => {
    if (CFG.digitizeParcelsUrl) {
      window.open(CFG.digitizeParcelsUrl, "_blank", "noopener");
    }
  });

  renderAcquisitionStats(); // zeros for now
}

/** Unique-value renderer that fills parcels by acquisition status (matches the
 * Affected Parcels panel legend dots). */
function acquisitionRenderer() {
  const fill = (rgb) => ({
    type: "simple-fill",
    color: [rgb[0], rgb[1], rgb[2], 0.55],
    outline: { color: rgb, width: 1.5 }
  });
  return {
    type: "unique-value",
    field: "acquisition_status",
    defaultSymbol: fill([110, 110, 110]),
    uniqueValueInfos: [
      { value: "Not acquired", symbol: fill([110, 110, 110]) },
      { value: "Acquired", symbol: fill([53, 172, 70]) },
      { value: "Pending consent signing", symbol: fill([245, 168, 0]) },
      { value: "Acquisition failed", symbol: fill([216, 48, 32]) }
    ]
  };
}

function initMap(attrs) {
  const mapEl = $("corridor-map");
  mapEl.basemap = CFG.basemap;
  // Fallback framing (Nairobi) until the facility point is located.
  mapEl.center = CFG.initialCenter;
  mapEl.zoom = CFG.initialZoom;

  // Default state — no wayleave corridor generated yet: show every parcel from
  // the Wayleaves parcels layer plus all Survey & Design Assets sublayers, and
  // zoom to the project's associated facility (falling back to Kenya's extent).
  // Load parcels + corridor from the Wayleaves portal item so they render with
  // the item's configured symbology (fall back to the raw service url).
  const parcels = new FeatureLayer({
    ...(CFG.wayleavesItemId
      ? { portalItem: { id: CFG.wayleavesItemId }, layerId: CFG.parcelsLayerId }
      : { url: CFG.parcelsLayerUrl }),
    outFields: ["*"],
    title: "Parcels"
  });

  // This project's wayleave corridor polygon (output of the corridor GP tool),
  // filtered to its reference_number and drawn on top of the parcels.
  const ref = attrs && attrs.project_reference_number;
  const corridorLayer = new FeatureLayer({
    ...(CFG.wayleavesItemId
      ? { portalItem: { id: CFG.wayleavesItemId }, layerId: CFG.corridorLayerId }
      : { url: CFG.corridorLayerUrl }),
    outFields: ["*"],
    title: "Wayleave Corridor",
    definitionExpression: ref
      ? `reference_number = '${String(ref).replace(/'/g, "''")}'`
      : "1=0"
  });

  // Affected parcels (crossed by this project's corridor), coloured by
  // acquisition status and drawn over the base parcels (which keep service
  // symbology). Matched by this project's reference in the wayleave_id list.
  const affectedParcels = new FeatureLayer({
    url: CFG.parcelsLayerUrl,
    outFields: ["*"],
    title: "Affected Parcels",
    definitionExpression: ref
      ? `wayleave_id LIKE '%${String(ref).replace(/'/g, "''")}%'`
      : "1=0",
    renderer: acquisitionRenderer()
  });

  let initialized = false;
  const onReady = async () => {
    if (initialized || !mapEl.ready) return;
    initialized = true;
    mapEl.map.add(parcels);
    mapEl.map.add(affectedParcels);
    mapEl.map.add(corridorLayer);
    try {
      await loadAssetLayers(mapEl.map);
    } catch (err) {
      alertUser("Asset layers", err.message, "warning");
    }
    // Zoom to the associated facility; if none matches, frame Kenya's extent.
    const framed = await centerOnFacility(
      mapEl.view,
      attrs && attrs.project_reference_number
    );
    if (!framed) {
      try {
        await mapEl.view.goTo(new Extent(CFG.kenyaExtent));
      } catch (err) {
        /* keep the fallback view if framing fails */
      }
    }
  };

  // The map lives in an initially-hidden tab, so its view becomes ready only
  // once that tab is shown. Handle both "already ready" and "ready later".
  if (mapEl.ready) {
    onReady();
  } else {
    mapEl.addEventListener("arcgisViewReadyChange", onReady);
  }

  wireCorridorPanel();
}

/* ------------------------------------------------------------------------ *
 * UI plumbing
 * ------------------------------------------------------------------------ */

function alertUser(title, message, kind) {
  $("alert-title").textContent = title;
  $("alert-message").textContent = message;
  const el = $("app-alert");
  el.kind = kind;
  el.open = true;
}

/* ------------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------------ */

async function boot() {
  $("back-btn").addEventListener("click", () => {
    window.location.href = "index.html";
  });

  try {
    const oid = getOid();
    if (oid == null) throw new Error("No project id in the URL (?oid=…).");

    esriConfig.portalUrl = CFG.portalUrl;
    await ensureSignedIn();

    const attrs = await fetchProject(oid);
    renderHeader(attrs);
    renderOverview(attrs);

    await customElements.whenDefined("arcgis-map");
    initMap(attrs);

    await loadAffectedParcels(attrs.project_reference_number);
    await initParcelsTable(attrs.project_reference_number, oid);
  } catch (err) {
    $("project-title").textContent = "Could not load project";
    alertUser("Error", err.message, "danger");
  } finally {
    $("boot-scrim").hidden = true;
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

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
import Extent from "https://js.arcgis.com/4.31/@arcgis/core/geometry/Extent.js";
import esriId from "https://js.arcgis.com/4.31/@arcgis/core/identity/IdentityManager.js";

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
  const token = await Auth.valid();
  const res = await fetch(
    CFG.assetsServiceUrl + "?f=json&token=" + encodeURIComponent(token)
  );
  const svc = await res.json();
  if (svc.error) throw new Error(svc.error.message || "Could not read asset layers.");

  const group = new GroupLayer({
    title: "Survey & Design Assets",
    visibilityMode: "independent"
  });
  (svc.layers || []).forEach((l) => {
    group.add(
      new FeatureLayer({
        url: CFG.assetsServiceUrl + "/" + l.id,
        title: l.name,
        outFields: ["*"]
      })
    );
  });
  map.add(group);
}

/** Populate the affected-parcels panel. Zeros until the backend computes the
 * corridor's affected parcels; call with real counts once wired. */
function renderAcquisitionStats(stats) {
  const s = stats || { total: 0, notAcquired: 0, acquired: 0, pending: 0, failed: 0 };
  $("parcels-total").textContent = s.total;
  $("dist-not-acquired").textContent = s.notAcquired;
  $("dist-acquired").textContent = s.acquired;
  $("dist-pending").textContent = s.pending;
  $("dist-failed").textContent = s.failed;
}

/** Show / hide the floating affected-parcels panel. */
function setCorridorPanelOpen(open) {
  if (open) $("corridor-panel").closed = false; // clear the panel's own close
  $("corridor-card").hidden = !open;
  $("corridor-reopen").hidden = open;
}

/** Wire the corridor panel: close/reopen + the three action buttons. */
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

  // Upload parcels .shp — opens a file picker but does nothing with it yet.
  const input = $("parcels-input");
  $("upload-parcels-btn").addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    input.value = ""; // discard the selection
    alertUser("Received", "Parcel shapefile upload isn’t wired up yet.", "info");
  });

  // Digitize parcels — open the configured portal item in a new tab.
  $("digitize-parcels-btn").addEventListener("click", () => {
    if (CFG.digitizeParcelsUrl) {
      window.open(CFG.digitizeParcelsUrl, "_blank", "noopener");
    }
  });

  renderAcquisitionStats(); // zeros for now
}

function initMap() {
  const mapEl = $("corridor-map");
  mapEl.basemap = CFG.basemap;
  // Fallback framing (Nairobi) until the parcels extent is known.
  mapEl.center = CFG.initialCenter;
  mapEl.zoom = CFG.initialZoom;

  // Default state — no wayleave corridor generated yet: show every parcel from
  // the Wayleaves parcels layer plus all Survey & Design Assets sublayers, and
  // frame the map to Kenya's extent.
  const parcels = new FeatureLayer({
    url: CFG.parcelsLayerUrl,
    outFields: ["*"],
    title: "Parcels"
  });

  let initialized = false;
  const onReady = async () => {
    if (initialized || !mapEl.ready) return;
    initialized = true;
    mapEl.map.add(parcels);
    try {
      await loadAssetLayers(mapEl.map);
    } catch (err) {
      alertUser("Asset layers", err.message, "warning");
    }
    try {
      // Open to the extent of Kenya (the parcels sit within it).
      await mapEl.view.goTo(new Extent(CFG.kenyaExtent));
    } catch (err) {
      /* keep the fallback view if framing fails */
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
    Auth.setIdentityManager(esriId);
    await Auth.mint();

    const attrs = await fetchProject(oid);
    renderHeader(attrs);
    renderOverview(attrs);

    await customElements.whenDefined("arcgis-map");
    initMap();
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

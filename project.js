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

function initMap() {
  const mapEl = $("corridor-map");
  mapEl.basemap = CFG.basemap;
  // Fallback framing (Nairobi) until the parcels extent is known.
  mapEl.center = CFG.initialCenter;
  mapEl.zoom = CFG.initialZoom;

  // Default state — no wayleave corridor generated yet: show every parcel from
  // the Wayleaves parcels layer and frame the map to their full extent.
  const parcels = new FeatureLayer({
    url: CFG.parcelsLayerUrl,
    outFields: ["*"],
    title: "Parcels"
  });

  let framed = false;
  const showParcels = async () => {
    if (framed || !mapEl.ready) return;
    framed = true;
    mapEl.map.add(parcels);
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
    showParcels();
  } else {
    mapEl.addEventListener("arcgisViewReadyChange", showParcels);
  }

  $("generate-corridor-btn").addEventListener("click", () => {
    alertUser(
      "Not wired up yet",
      "Corridor generation will call the backend server.",
      "info"
    );
  });
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

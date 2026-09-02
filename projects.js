/* ---------------------------------------------------------------------------
 * projects.js — Projects list screen (ES module).
 *
 * Renders the secured Projects table with <arcgis-feature-table>. Clicking any
 * project row (or the trailing "Open" launch icon) navigates to the details
 * page for that record: project.html?oid=<objectid>.
 *
 * Core classes are imported from the same /4.31/@arcgis/core CDN path the map
 * components use, so the FeatureLayer we build is the exact class the component
 * expects — one shared JSAPI instance, no dual-core mismatch.
 * ------------------------------------------------------------------------- */

import esriConfig from "https://js.arcgis.com/4.31/@arcgis/core/config.js";
import FeatureLayer from "https://js.arcgis.com/4.31/@arcgis/core/layers/FeatureLayer.js";
import esriId from "https://js.arcgis.com/4.31/@arcgis/core/identity/IdentityManager.js";

const CFG = window.APP_CONFIG;
const $ = (id) => document.getElementById(id);

let projectsLayer = null;

/* ------------------------------------------------------------------------ *
 * Table
 * ------------------------------------------------------------------------ */

/* Per-column value filters, keyed by field name. Combined into one
 * definitionExpression on the layer, which the table re-queries against. */
const activeFilters = {};

/** Build the FeatureTable tableTemplate from config.projectColumns.
 * Each column gets a "Filter…" / "Clear filter" item in its header (⋯) menu,
 * appended alongside the built-in Sort options. */
function buildTableTemplate() {
  return {
    columnTemplates: CFG.projectColumns.map((c) => ({
      type: "field",
      fieldName: c.field,
      label: c.label,
      // Fixed widths keep the columns compact so the attachments column (and its
      // launch icon) stays in view instead of overflowing off the right edge.
      width: c.width,
      autoWidth: false,
      menuConfig: {
        items: [
          {
            label: "Filter…",
            iconClass: "esri-icon-filter",
            clickFunction: () => promptFilter(c.field, c.label)
          },
          {
            label: "Clear filter",
            iconClass: "esri-icon-close",
            clickFunction: () => applyFilter(c.field, null)
          }
        ]
      }
    }))
  };
}

/* The column currently being edited in the filter dialog. */
let filterField = null;

/** Open the Calcite filter modal for a column, pre-filled with its filter. */
function promptFilter(field, label) {
  filterField = field;
  const dialog = $("filter-dialog");
  const input = $("filter-input");
  $("filter-dialog-heading").textContent = `Filter — ${label}`;
  $("filter-dialog-label").textContent = `"${label}" contains`;
  input.value = activeFilters[field] || "";
  dialog.open = true;
  // Focus the input once the modal has opened.
  requestAnimationFrame(() => input.setFocus && input.setFocus());
}

/** Wire the filter modal + Clear all interactions once. */
function wireFilterDialog() {
  const dialog = $("filter-dialog");
  const input = $("filter-input");

  const apply = () => {
    if (filterField) applyFilter(filterField, input.value.trim() || null);
    dialog.open = false;
  };

  $("filter-apply").addEventListener("click", apply);
  $("filter-cancel").addEventListener("click", () => (dialog.open = false));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") apply();
  });
  $("clear-all-filters").addEventListener("click", clearAllFilters);
}

/** Set or clear one column filter. */
function applyFilter(field, value) {
  if (value) activeFilters[field] = value;
  else delete activeFilters[field];
  syncFilters();
}

/** Clear every column filter at once. */
function clearAllFilters() {
  Object.keys(activeFilters).forEach((f) => delete activeFilters[f]);
  syncFilters();
}

/** Rebuild the layer definitionExpression and the applied-filters chip bar. */
function syncFilters() {
  const clauses = Object.entries(activeFilters).map(
    ([f, v]) => `UPPER(${f}) LIKE UPPER('%${v.replace(/'/g, "''")}%')`
  );
  const filterExpr = clauses.join(" AND ");
  // Always keep the base wayleave-stage filter; AND the column filters on top.
  projectsLayer.definitionExpression = filterExpr
    ? `(${CFG.projectsWhere}) AND (${filterExpr})`
    : CFG.projectsWhere;
  renderFilterChips();
}

/** Render one removable chip per active filter above the table. */
function renderFilterChips() {
  const bar = $("active-filters");
  const chips = $("filter-chips");
  chips.innerHTML = "";

  const entries = Object.entries(activeFilters);
  bar.hidden = entries.length === 0;

  entries.forEach(([field, value]) => {
    const col = CFG.projectColumns.find((c) => c.field === field);
    const chip = document.createElement("calcite-chip");
    chip.setAttribute("closable", "");
    chip.setAttribute("scale", "s");
    chip.setAttribute("appearance", "outline-fill");
    chip.setAttribute("kind", "brand");
    chip.textContent = `${col ? col.label : field}: ${value}`;
    chip.addEventListener("calciteChipClose", () => applyFilter(field, null));
    chips.appendChild(chip);
  });
}

async function initTable() {
  projectsLayer = new FeatureLayer({
    url: CFG.projectsLayerUrl,
    outFields: ["*"],
    // Only show projects in the Wayleave Acquisition stage; column filters
    // (syncFilters) are AND-ed on top of this base clause.
    definitionExpression: CFG.projectsWhere,
    // Label records by project name (e.g. in the attachments view breadcrumb)
    // instead of the default OBJECTID.
    displayField: "project_name"
  });

  await projectsLayer.load();

  const tableEl = $("projects-table");
  tableEl.tableTemplate = buildTableTemplate();
  tableEl.layer = projectsLayer;

  wireFilterDialog();

  // Whole-row navigation: clicking any cell in a row opens that project.
  tableEl.addEventListener("arcgisCellClick", (event) => {
    const oid = objectIdFromCellEvent(event);
    if (oid != null) goToDetails(oid);
  });

  // Refresh button is optional in the layout — only wire it if present.
  const refresh = $("refresh-btn");
  if (refresh) refresh.addEventListener("click", () => projectsLayer.refresh());
}

/** Pull the objectid out of the cell-click event, tolerating API shapes. */
function objectIdFromCellEvent(event) {
  const d = event.detail || {};
  const feature =
    d.feature ||
    d.graphic ||
    (d.item && d.item.feature) ||
    (d.target && d.target.feature);

  if (feature && feature.attributes) {
    const a = feature.attributes;
    return a.objectid ?? a.OBJECTID ?? a.ObjectId ?? null;
  }
  if (d.objectId != null) return d.objectId;
  return null;
}

function goToDetails(oid) {
  window.location.href = "project.html?oid=" + encodeURIComponent(oid);
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
  try {
    esriConfig.portalUrl = CFG.portalUrl;
    Auth.setIdentityManager(esriId);
    await Auth.mint();

    await customElements.whenDefined("arcgis-feature-table");
    await initTable();
  } catch (err) {
    alertUser("Could not load projects", err.message, "danger");
  } finally {
    $("boot-scrim").hidden = true;
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

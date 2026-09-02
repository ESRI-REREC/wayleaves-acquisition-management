/* ---------------------------------------------------------------------------
 * parcel.js — Parcel / ownership screen (ES module).
 *
 * Opened from an Affected Parcels row: parcel.html?oid=<parcelObjectId>&
 * ref=<projectReference>&project=<projectObjectId>. Shows:
 *   • a map snippet of this parcel + the route crossing it + the corridor section;
 *   • the parcel summary;
 *   • the parcel's owners (Wayleaves/2, linked by parcel_no) with per-owner
 *     Upload National ID / Upload KRA PIN attachments, plus an Add owner form;
 *   • parcel documents: upload land-ownership document, generate a consent-form
 *     PDF, and upload a signed consent form — the uploads attach to the parcel.
 * ------------------------------------------------------------------------- */

import esriConfig from "https://js.arcgis.com/4.31/@arcgis/core/config.js";
import FeatureLayer from "https://js.arcgis.com/4.31/@arcgis/core/layers/FeatureLayer.js";
import GroupLayer from "https://js.arcgis.com/4.31/@arcgis/core/layers/GroupLayer.js";
import Graphic from "https://js.arcgis.com/4.31/@arcgis/core/Graphic.js";
import { ensureSignedIn, getServerToken, getUsername } from "./oauth.js";

const CFG = window.APP_CONFIG;
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------------ */

let parcelLayer = null; // Wayleaves/0
let ownersLayer = null; // Wayleaves/2
let parcelAttrs = null; // this parcel's attributes
let parcelGeom = null; // this parcel's geometry
let parcelOid = null; // this parcel's objectid
let ownerRows = []; // current owners' attributes (for the consent PDF)
let mapView = null; // the parcel map view (for the consent-form plan snapshot)
let parcelGraphic = null; // the parcel highlight (recoloured on status change)

const fieldTypes = {}; // parcel field name -> esri type, for date formatting

function params() {
  const p = new URLSearchParams(window.location.search);
  return {
    oid: p.get("oid") != null ? Number(p.get("oid")) : null,
    ref: p.get("ref") || "",
    project: p.get("project") || ""
  };
}

const P = params();

/* ------------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------------ */

function alertUser(title, message, kind) {
  $("alert-title").textContent = title;
  $("alert-message").textContent = message;
  const el = $("app-alert");
  el.kind = kind;
  el.open = true;
}

function slug(value, fallback) {
  const s = String(value || "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || fallback || "file";
}

function extensionOf(name) {
  const dot = (name || "").lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/** Attachment name without its extension (to match "same kind" uploads). */
function baseNameOf(name) {
  const dot = (name || "").lastIndexOf(".");
  return dot >= 0 ? name.slice(0, dot) : name || "";
}

function esc(value) {
  return String(value == null ? "" : value).replace(/'/g, "''");
}

/** Open a file picker and attach the chosen file (renamed to baseName.<ext>) to
 * `oid` on `layer`. Calls onDone on success. */
function pickAndUpload(layer, layerUrl, oid, baseName, onDone) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,.pdf"; // documents must be PDF
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      return alertUser("PDF required", "Only PDF documents can be uploaded.", "warning");
    }
    const maxMB = 25;
    if (file.size > maxMB * 1024 * 1024) {
      return alertUser("File too large", `The document exceeds ${maxMB} MB.`, "warning");
    }
    try {
      const graphic = new Graphic({ attributes: { [layer.objectIdField]: oid } });

      // Replace: drop any existing attachment of the same kind (same base name).
      try {
        const byOid = await layer.queryAttachments({ objectIds: [oid] });
        const stale = ((byOid && byOid[oid]) || [])
          .filter((att) => baseNameOf(att.name) === baseName)
          .map((att) => att.id);
        if (stale.length) await layer.deleteAttachments(graphic, stale);
      } catch (_) {
        /* if listing/deleting fails, still add the new one */
      }

      const form = new FormData();
      form.append("attachment", file, baseName + extensionOf(file.name));
      const result = await layer.addAttachment(graphic, form);
      if (!result || result.success === false) {
        throw new Error((result && result.error && result.error.message) || "upload rejected");
      }
      alertUser("Uploaded", `${baseName}${extensionOf(file.name)} attached.`, "success");
      if (onDone) onDone();
    } catch (err) {
      alertUser("Upload failed", err.message, "danger");
    }
  });
  input.click();
}

/** Render an attachment list (as token'd links) for `oid` into `containerEl`. */
async function renderAttachments(layer, layerUrl, oid, containerEl, emptyText) {
  containerEl.innerHTML = "";
  try {
    const byOid = await layer.queryAttachments({ objectIds: [oid] });
    const items = (byOid && byOid[oid]) || [];
    if (!items.length) {
      containerEl.innerHTML = `<span class="attach-empty">${emptyText}</span>`;
      return;
    }
    const token = await getServerToken();
    items.forEach((att) => {
      const a = document.createElement("a");
      a.href = `${layerUrl}/${oid}/attachments/${att.id}?token=${encodeURIComponent(token)}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = att.name || `Attachment ${att.id}`;
      containerEl.appendChild(a);
    });
  } catch (err) {
    containerEl.innerHTML = `<span class="attach-empty">Could not load documents: ${err.message}</span>`;
  }
}

/* ------------------------------------------------------------------------ *
 * Parcel
 * ------------------------------------------------------------------------ */

async function fetchParcel() {
  parcelLayer = new FeatureLayer({ url: CFG.parcelsLayerUrl, outFields: ["*"] });
  await parcelLayer.load();
  parcelLayer.fields.forEach((f) => (fieldTypes[f.name] = f.type));

  const result = await parcelLayer.queryFeatures({
    objectIds: [P.oid],
    outFields: ["*"],
    returnGeometry: true
  });
  const feature = (result.features || [])[0];
  if (!feature) throw new Error("Parcel " + P.oid + " was not found.");
  parcelAttrs = feature.attributes;
  parcelGeom = feature.geometry;
  parcelOid = parcelAttrs[parcelLayer.objectIdField];
}

function formatValue(value, field) {
  if (value == null || value === "") return "—";
  if (["date", "date-only", "timestamp-offset"].includes(fieldTypes[field])) {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }
  return String(value);
}

function renderParcel() {
  $("parcel-title").textContent = parcelAttrs.parcel_no || "Parcel";
  document.title = (parcelAttrs.parcel_no || "Parcel") + " · Wayleave Acquisition Management";
  $("parcel-sub").textContent = parcelAttrs.lr_no ? "L.R. " + parcelAttrs.lr_no : "";

  const status = parcelAttrs.acquisition_status;
  const chip = $("parcel-status");
  if (status) {
    chip.textContent = status;
    chip.hidden = false;
  }

  const dl = $("parcel-details");
  dl.innerHTML = "";
  const rows = [
    ["Parcel No.", "parcel_no"],
    ["L.R. No.", "lr_no"],
    ["Size", "size"],
    ["Acquisition Status", "acquisition_status"]
  ];
  // Who set the current status, and when (from that status's audit fields).
  const meta = statusMeta(parcelAttrs.acquisition_status);
  if (meta && parcelAttrs[meta.by]) rows.push(["Status set by", meta.by]);
  if (meta && parcelAttrs[meta.date]) rows.push(["Status set on", meta.date]);

  rows.forEach(([label, field]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = formatValue(parcelAttrs[field], field);
    dl.append(dt, dd);
  });
}

/* ------------------------------------------------------------------------ *
 * Map snippet
 * ------------------------------------------------------------------------ */

/* Parcel fill colour by acquisition status (matches the panel legend dots).
 * The route + corridor keep their own service/item symbology; only the parcel
 * highlight is colour-coded. */
const STATUS_RGB = {
  "not acquired": [110, 110, 110],
  "acquired": [53, 172, 70],
  "pending consent signing": [245, 168, 0],
  "acquisition failed": [216, 48, 32]
};

function parcelSymbol() {
  const rgb =
    STATUS_RGB[String(parcelAttrs.acquisition_status || "").trim().toLowerCase()] ||
    [110, 110, 110];
  return {
    type: "simple-fill",
    color: [rgb[0], rgb[1], rgb[2], 0.28],
    outline: { color: rgb, width: 2 }
  };
}

function initMap() {
  const mapEl = $("parcel-map");
  mapEl.basemap = CFG.basemap;

  const refWhere = P.ref ? `reference_number = '${esc(P.ref)}'` : "1=0";

  const onReady = async () => {
    mapView = mapEl.view;
    try {
      // The corridor section for this project (from the portal item so it uses
      // the service's configured symbology).
      mapEl.map.add(
        new FeatureLayer({
          ...(CFG.wayleavesItemId
            ? { portalItem: { id: CFG.wayleavesItemId }, layerId: CFG.corridorLayerId }
            : { url: CFG.corridorLayerUrl }),
          outFields: ["*"],
          title: "Wayleave Corridor",
          definitionExpression: refWhere
        })
      );

      // The design route lines crossing this parcel (from the portal item so they
      // inherit the saved symbology), filtered to the project.
      const routes = new GroupLayer({ title: "Route", visibilityMode: "independent" });
      (CFG.routeLayerIds || []).forEach((id) => {
        const props = CFG.assetsItemId
          ? { portalItem: { id: CFG.assetsItemId }, layerId: id }
          : { url: CFG.assetsServiceUrl + "/" + id };
        routes.add(new FeatureLayer({ ...props, outFields: ["*"], definitionExpression: refWhere }));
      });
      mapEl.map.add(routes);

      // Highlight this parcel (coloured by acquisition status) and frame it.
      parcelGraphic = new Graphic({ geometry: parcelGeom, symbol: parcelSymbol() });
      mapEl.view.graphics.add(parcelGraphic);
      // Frame the view on the parcel's own extent.
      if (parcelGeom && parcelGeom.extent) {
        await mapEl.view.goTo(parcelGeom.extent);
      }
    } catch (err) {
      alertUser("Map error", err.message, "warning");
    }
  };

  if (mapEl.ready) onReady();
  else mapEl.addEventListener("arcgisViewReadyChange", () => mapEl.ready && onReady(), { once: true });
}

/* ------------------------------------------------------------------------ *
 * Owners
 * ------------------------------------------------------------------------ */

async function loadOwners() {
  ownersLayer = ownersLayer || new FeatureLayer({ url: CFG.ownersTableUrl, outFields: ["*"] });
  await ownersLayer.load();

  const result = await ownersLayer.queryFeatures({
    where: `parcel_no = '${esc(parcelAttrs.parcel_no)}'`,
    outFields: ["*"],
    returnGeometry: false
  });
  ownerRows = (result.features || []).map((f) => f.attributes);
  renderOwners();
}

function renderOwners() {
  const list = $("owners-list");
  list.innerHTML = "";
  if (!ownerRows.length) {
    list.innerHTML = '<span class="attach-empty">No owners recorded yet.</span>';
    return;
  }

  ownerRows.forEach((o) => {
    const oid = o[ownersLayer.objectIdField];
    const card = document.createElement("div");
    card.className = "owner-card";

    // Left: owner name + details.
    const main = document.createElement("div");
    main.className = "owner-main";

    const head = document.createElement("div");
    head.className = "owner-head";
    const name = document.createElement("span");
    name.className = "owner-name";
    name.textContent = o.name || "Unnamed owner";
    head.appendChild(name);
    if (Number(o.is_primary_owner) === 1) {
      const chip = document.createElement("calcite-chip");
      chip.setAttribute("scale", "s");
      chip.setAttribute("kind", "brand");
      chip.setAttribute("appearance", "solid");
      chip.textContent = "Primary";
      head.appendChild(chip);
    }
    main.appendChild(head);

    const dl = document.createElement("dl");
    dl.className = "detail-list owner-details";
    [
      ["ID Number", o.id],
      ["KRA PIN", o.kra_pin],
      ["Phone", o.phone_number],
      ["Share", o.share_pct != null ? o.share_pct + "%" : null]
    ].forEach(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value == null || value === "" ? "—" : String(value);
      dl.append(dt, dd);
    });
    main.appendChild(dl);
    card.appendChild(main);

    // Right: documents list + upload buttons.
    const side = document.createElement("div");
    side.className = "owner-side";

    const docs = document.createElement("div");
    docs.className = "attach-list owner-docs";
    const refreshDocs = () =>
      renderAttachments(ownersLayer, CFG.ownersTableUrl, oid, docs, "No documents uploaded.");
    refreshDocs();
    side.appendChild(docs);

    const actions = document.createElement("div");
    actions.className = "owner-actions";
    const base = slug(o.name, "owner");
    const idBtn = ownerUploadButton("Upload National ID", "identification", () =>
      pickAndUpload(ownersLayer, CFG.ownersTableUrl, oid, base + "_National_ID", refreshDocs)
    );
    const kraBtn = ownerUploadButton("Upload KRA PIN", "id-card", () =>
      pickAndUpload(ownersLayer, CFG.ownersTableUrl, oid, base + "_KRA_PIN", refreshDocs)
    );
    actions.append(idBtn, kraBtn);
    side.appendChild(actions);
    card.appendChild(side);

    list.appendChild(card);
  });
}

function ownerUploadButton(label, icon, onClick) {
  const btn = document.createElement("calcite-button");
  btn.setAttribute("appearance", "outline");
  btn.setAttribute("icon-start", icon);
  btn.setAttribute("width", "full"); // larger, full-width in the right column
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

/* ---- Add owner sheet ---------------------------------------------------- */

function openOwnerSheet() {
  $("owner-name").value = "";
  $("owner-id").value = "";
  $("owner-kra").value = "";
  $("owner-phone").value = "";
  $("owner-share").value = "";
  $("owner-primary").checked = false;
  $("owner-sheet").open = true;
}

function wireOwnerSheet() {
  $("add-owner-btn").addEventListener("click", openOwnerSheet);
  $("owner-close").addEventListener("click", () => ($("owner-sheet").open = false));
  $("owner-cancel").addEventListener("click", () => ($("owner-sheet").open = false));
  $("owner-submit").addEventListener("click", submitOwner);
}

async function submitOwner() {
  const name = ($("owner-name").value || "").trim();
  if (!name) return alertUser("Name required", "Enter the owner's name.", "warning");

  const shareRaw = $("owner-share").value;
  const attributes = {
    name,
    id: ($("owner-id").value || "").trim() || null,
    kra_pin: ($("owner-kra").value || "").trim() || null,
    phone_number: ($("owner-phone").value || "").trim() || null,
    share_pct: shareRaw === "" || shareRaw == null ? null : Number(shareRaw),
    is_primary_owner: $("owner-primary").checked ? 1 : 0,
    parcel_no: parcelAttrs.parcel_no
  };

  const submit = $("owner-submit");
  submit.loading = true;
  try {
    const result = await ownersLayer.applyEdits({ addFeatures: [{ attributes }] });
    const r = (result.addFeatureResults || [])[0];
    if (!r || r.error) throw new Error((r && r.error && r.error.message) || "add rejected");
    $("owner-sheet").open = false;
    alertUser("Owner added", `${name} added to ${parcelAttrs.parcel_no}.`, "success");
    await loadOwners();
  } catch (err) {
    alertUser("Could not add owner", err.message, "danger");
  } finally {
    submit.loading = false;
  }
}

/* ------------------------------------------------------------------------ *
 * Parcel documents
 * ------------------------------------------------------------------------ */

function loadParcelAttachments() {
  return renderAttachments(
    parcelLayer,
    CFG.parcelsLayerUrl,
    parcelOid,
    $("parcel-attachments"),
    "No parcel documents uploaded yet."
  );
}

function wireParcelDocs() {
  $("upload-ownership-btn").addEventListener("click", () =>
    pickAndUpload(parcelLayer, CFG.parcelsLayerUrl, parcelOid,
      slug(parcelAttrs.parcel_no, "parcel") + "_ownership", loadParcelAttachments)
  );
  $("upload-signed-btn").addEventListener("click", () =>
    pickAndUpload(parcelLayer, CFG.parcelsLayerUrl, parcelOid,
      slug(parcelAttrs.parcel_no, "parcel") + "_signed_consent", loadParcelAttachments)
  );
  $("generate-consent-btn").addEventListener("click", generateConsentPdf);
}

/** Build a consent-form PDF (client-side, jsPDF) from the parcel + owners, with
 * a snapshot of the parcel map as the attached plan. */
async function generateConsentPdf() {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) return alertUser("PDF unavailable", "The PDF library did not load.", "danger");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("WAYLEAVE CONSENT FORM", pageW / 2, y, { align: "center" });
  y += 30;

  const row = (text, gap = 18, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(11);
    doc.text(String(text), margin, y);
    y += gap;
  };

  row(`Project reference: ${P.ref || "—"}`);
  row(`Parcel No.: ${parcelAttrs.parcel_no || "—"}`);
  row(`L.R. No.: ${parcelAttrs.lr_no || "—"}`);
  row(`Approx. size: ${parcelAttrs.size != null ? parcelAttrs.size : "—"}`);
  y += 8;

  row("Registered owner(s):", 20, true);
  if (ownerRows.length) {
    ownerRows.forEach((o, i) => {
      row(
        `${i + 1}. ${o.name || "—"}   ID: ${o.id || "—"}   KRA: ${o.kra_pin || "—"}   ` +
          `Share: ${o.share_pct != null ? o.share_pct + "%" : "—"}` +
          (Number(o.is_primary_owner) === 1 ? "   (Primary)" : ""),
        16
      );
    });
  } else {
    row("(none recorded)", 16);
  }
  y += 16;

  const consent =
    "I/We, the registered owner(s) named above, hereby grant consent for the " +
    "establishment of an electricity wayleave corridor across the above parcel, " +
    "as shown in the attached plan, subject to the agreed terms and compensation.";
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const wrapped = doc.splitTextToSize(consent, pageW - 2 * margin);
  doc.text(wrapped, margin, y);
  y += wrapped.length * 15 + 28;

  (ownerRows.length ? ownerRows : [{ name: "" }]).forEach((o) => {
    row(`Owner: ${o.name || ""}`, 24);
    row("Signature: ______________________________     Date: ________________", 34);
  });

  // Attach the parcel map as the plan on a second page.
  if (mapView) {
    try {
      const shot = await mapView.takeScreenshot({ format: "png", width: 1200 });
      doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("Plan", margin, margin);
      const imgW = pageW - 2 * margin;
      const imgH = imgW * (shot.data.height / shot.data.width);
      doc.addImage(shot.dataUrl, "PNG", margin, margin + 14, imgW, imgH);
    } catch (_) {
      /* screenshot unavailable — leave the text-only form */
    }
  }

  doc.save(slug(parcelAttrs.parcel_no, "parcel") + "_consent.pdf");
}

/* ------------------------------------------------------------------------ *
 * Change acquisition status
 * ------------------------------------------------------------------------ */

/* Each status carries its own audit pair on the parcel: <key>_by / <key>_date,
 * stamped when the status is set (so the layer keeps who/when for every status). */
const STATUS_META = [
  { label: "Not acquired", by: "not_acquired_by", date: "not_acquired_date" },
  { label: "Acquired", by: "acquired_by", date: "acquired_date" },
  { label: "Pending consent signing", by: "pending_by", date: "pending_date" },
  { label: "Acquisition failed", by: "failed_by", date: "failed_date" }
];

function statusMeta(label) {
  const key = String(label || "").trim().toLowerCase();
  return STATUS_META.find((s) => s.label.toLowerCase() === key) || null;
}

function wireStatusSheet() {
  const sel = $("status-select");
  sel.innerHTML = "";
  STATUS_META.forEach((s) => {
    const opt = document.createElement("calcite-option");
    opt.value = s.label;
    opt.textContent = s.label;
    sel.appendChild(opt);
  });
  $("change-status-btn").addEventListener("click", openStatusSheet);
  $("status-close").addEventListener("click", () => ($("status-sheet").open = false));
  $("status-cancel").addEventListener("click", () => ($("status-sheet").open = false));
  $("status-submit").addEventListener("click", submitStatus);
}

function openStatusSheet() {
  $("status-select").value = parcelAttrs.acquisition_status || "";
  const meta = statusMeta(parcelAttrs.acquisition_status);
  const by = meta ? parcelAttrs[meta.by] : null;
  const date = meta ? parcelAttrs[meta.date] : null;
  $("status-current").textContent = parcelAttrs.acquisition_status
    ? "Current: " + parcelAttrs.acquisition_status +
      (by ? " · set by " + by : "") +
      (date ? " on " + new Date(date).toLocaleDateString() : "")
    : "No status set yet.";
  $("status-sheet").open = true;
}

/** Set acquisition_status and stamp that status's audit pair (who + now). */
async function submitStatus() {
  const chosen = $("status-select").value;
  if (!chosen) return alertUser("Status required", "Choose an acquisition status.", "warning");

  const meta = statusMeta(chosen);
  const attributes = { [parcelLayer.objectIdField]: parcelOid, acquisition_status: chosen };
  if (meta) {
    attributes[meta.by] = getUsername() || null;
    attributes[meta.date] = Date.now();
  }

  const btn = $("status-submit");
  btn.loading = true;
  try {
    const result = await parcelLayer.applyEdits({ updateFeatures: [{ attributes }] });
    const r = (result.updateFeatureResults || [])[0];
    if (!r || r.error) throw new Error((r && r.error && r.error.message) || "update rejected");
    Object.assign(parcelAttrs, attributes); // reflect locally
    if (parcelGraphic) parcelGraphic.symbol = parcelSymbol(); // recolour on the map
    $("status-sheet").open = false;
    alertUser("Status updated", `Acquisition status set to "${chosen}".`, "success");
    renderParcel();
  } catch (err) {
    alertUser("Update failed", err.message, "danger");
  } finally {
    btn.loading = false;
  }
}

/* ------------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------------ */

async function boot() {
  $("back-btn").addEventListener("click", () => {
    window.location.href = P.project ? "project.html?oid=" + encodeURIComponent(P.project) : "index.html";
  });

  try {
    if (P.oid == null) throw new Error("No parcel id in the URL (?oid=…).");

    esriConfig.portalUrl = CFG.portalUrl;
    await ensureSignedIn();

    await fetchParcel();
    renderParcel();

    wireOwnerSheet();
    wireParcelDocs();
    wireStatusSheet();

    await Promise.all([loadOwners(), loadParcelAttachments()]);

    await customElements.whenDefined("arcgis-map");
    initMap();
  } catch (err) {
    $("parcel-title").textContent = "Could not load parcel";
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

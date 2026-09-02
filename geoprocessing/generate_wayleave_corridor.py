# -*- coding: utf-8 -*-
"""
generate_wayleave_corridor.py — ArcGIS Pro script tool / Web Tool.

For one project (reference_number), the tool:
  1. Reads the *Width Rules* table (voltage code -> total corridor width, m).
  2. Looks at each configured route layer (ROUTE_SOURCES) and selects that
     project's lines (reference_number = <ref>):
       • Proposed 1-Φ LV Lines  -> fixed 240 V
       • Proposed 3-Φ LV Lines  -> fixed 415 V
       • Proposed HT Lines      -> per-feature voltage_level field
  3. Buffers every line by (width / 2) each side for its voltage (GEODESIC —
     true ground metres), and dissolves everything into ONE corridor polygon.
  4. Replaces any previous corridor for the project and writes the new one to
     *Wayleave Corridors*, with reference_number = wayleave_id = <ref>.
  5. Selects the *Parcels* the corridor intersects, APPENDS <ref> to their
     wayleave_id (a ';'-separated list, since a parcel may fall in several
     projects' corridors) and seeds acquisition_status = "Not acquired" the
     first time a parcel becomes affected.

`width` in the rules table is the TOTAL corridor width (both sides); the tool
buffers by width / 2. Re-running for the same project is idempotent: it clears
the previous corridor and removes <ref> from its parcels' wayleave_id first
(clearing acquisition_status only for parcels left in no corridor).

------------------------------------------------------------------------------
SCRIPT-TOOL PARAMETERS (add these, in this order, in the tool's Properties):

  0  reference_number       String        Input   Required
  1  rules_table            Table         Input   Optional  (default = RULES_URL)
  2  corridor_layer         Feature Layer Input   Optional  (default = CORRIDOR_URL)
  3  parcels_layer          Feature Layer Input   Optional  (default = PARCELS_URL)
  4  half_width_override_m  Double        Input   Optional  (ignore the rules; use this half-width everywhere)
  5  corridors_written      Long          Output  Derived
  6  affected_parcels       Long          Output  Derived
  7  out_corridor           Feature Set   Output  Derived   (the generated polygon, for the app to draw)

The route layers are fixed in ROUTE_SOURCES below, so the web app only needs to
pass parameter 0 (reference_number).
------------------------------------------------------------------------------
"""

import arcpy
import datetime


# --- Service URLs (edit to match your org) --------------------------------- #
ASSETS = ("https://development.esriea.com/server/rest/services/"
          "Hosted/Survey_and_Design_Assets/FeatureServer")
WAYLEAVES = ("https://development.esriea.com/server/rest/services/"
             "Hosted/Wayleaves/FeatureServer")

RULES_URL = WAYLEAVES + "/3"     # Width Rules table  (voltage_level -> width)
CORRIDOR_URL = WAYLEAVES + "/1"  # Wayleave Corridors (output polygons)
PARCELS_URL = WAYLEAVES + "/0"   # Parcels (stamped with the project reference)

# A parcel may be crossed by several projects' corridors, so its wayleave_id
# holds a LINK_DELIM-separated list of project reference numbers. Its
# acquisition_status is seeded the first time the parcel becomes affected.
LINK_DELIM = ";"
STATUS_DEFAULT = "Not acquired"

# The route line layers, each tied to a project by REFERENCE_FIELD. A source is
# either fixed-voltage (voltage set, voltage_field None) or per-feature (voltage
# None, voltage_field names the attribute holding the volts).
REFERENCE_FIELD = "reference_number"
ROUTE_SOURCES = [
    {"url": ASSETS + "/13", "name": "Proposed 1-Φ LV Lines", "voltage": "240", "voltage_field": None},
    {"url": ASSETS + "/14", "name": "Proposed 3-Φ LV Lines", "voltage": "415", "voltage_field": None},
    {"url": ASSETS + "/1",  "name": "Proposed HT Lines",     "voltage": None,  "voltage_field": "voltage_level"},
]

# Textual voltage variants -> Width Rules voltage_level CODE (volts). Matched
# after lower-casing / stripping spaces. Extend if your data labels differ.
VOLTAGE_ALIASES = {
    "240": "240", "240v": "240",
    "415": "415", "415v": "415", "lv": "415",
    "11": "11000", "11kv": "11000", "11000": "11000",
    "33": "33000", "33kv": "33000", "33000": "33000",
    "66": "66000", "66kv": "66000", "66000": "66000",
    "132": "132000", "132kv": "132000", "132000": "132000",
    "220": "220000", "220kv": "220000", "220000": "220000",
}


def normalize_voltage(value):
    if value is None:
        return None
    key = str(value).strip().lower().replace(" ", "")
    if key in VOLTAGE_ALIASES:
        return VOLTAGE_ALIASES[key]
    return VOLTAGE_ALIASES.get(key.replace("kv", "").replace("v", ""))


def load_width_lookup(rules_url):
    """{voltage_level_code: total_width_m} from the Width Rules table."""
    lut = {}
    with arcpy.da.SearchCursor(rules_url, ["voltage_level", "width"]) as cur:
        for volt, width in cur:
            if volt is not None and width is not None:
                lut[str(volt).strip()] = float(width)
    return lut


def sql_equals(field, value):
    # Bare field name (no AddFieldDelimiters): hosted feature services reject the
    # [bracket] delimiters AddFieldDelimiters emits for a service URL it can't
    # classify as a workspace ("ERROR 000358 / Syntax error '['").
    return "{} = '{}'".format(field, str(value).replace("'", "''"))


def parse_ids(value):
    """Split a wayleave_id list-field into its reference numbers."""
    if not value:
        return []
    return [p.strip() for p in str(value).split(LINK_DELIM) if p.strip()]


def join_ids(ids):
    """Join reference numbers back into a de-duplicated list-field (or None)."""
    seen = []
    for x in ids:
        if x not in seen:
            seen.append(x)
    return LINK_DELIM.join(seen) if seen else None


def like_clause(field, needle):
    """Coarse filter for rows whose list-field may contain `needle`; the exact
    match is done in Python via parse_ids, so wildcard chars in `needle` only
    widen the (still-refined) filter. Bare field name + single-quote escaping —
    no AddFieldDelimiters (its [brackets] break hosted feature services)."""
    esc = str(needle).replace("'", "''")
    return "{} LIKE '%{}%'".format(field, esc)


def buffer_by_halfwidth(lines_fc, tag):
    """Buffer lines (HALF_M metres, geodesic) grouped by distinct half-width;
    return one dissolved polygon fc, or None if no line had a width."""
    # Only positive half-widths — a 0/None distance would raise ERROR 000026.
    halves = sorted({round(float(h), 4)
                     for (h,) in arcpy.da.SearchCursor(lines_fc, ["HALF_M"])
                     if h is not None and float(h) > 0})
    if not halves:
        return None
    parts = []
    for j, hw in enumerate(halves):
        grp = arcpy.management.MakeFeatureLayer(
            lines_fc, "g_{}_{}".format(tag, j), "HALF_M = {}".format(hw))[0]
        out = "memory/b_{}_{}".format(tag, j)
        arcpy.analysis.Buffer(grp, out, "{} Meters".format(hw),
                              line_side="FULL", line_end_type="ROUND",
                              dissolve_option="ALL", method="GEODESIC")
        parts.append(out)
    if len(parts) == 1:
        return parts[0]
    merged = "memory/bm_{}".format(tag)
    arcpy.management.Merge(parts, merged)
    return merged


def main():
    reference = arcpy.GetParameterAsText(0)
    rules_url = arcpy.GetParameterAsText(1) or RULES_URL
    corridor_url = arcpy.GetParameterAsText(2) or CORRIDOR_URL
    parcels_url = arcpy.GetParameterAsText(3) or PARCELS_URL
    half_override = arcpy.GetParameter(4)  # Double or None

    if not reference:
        arcpy.AddError("reference_number (parameter 0) is required.")
        return

    arcpy.env.overwriteOutput = True
    # Drop any cached service schemas so recently-added fields (e.g.
    # acquisition_status) are seen by this run.
    arcpy.management.ClearWorkspaceCache()

    lut = load_width_lookup(rules_url)
    arcpy.AddMessage("Width rules (voltage_code -> total width m): {}".format(lut))
    if half_override not in (None, ""):
        arcpy.AddMessage("half_width_override_m = {!r}".format(half_override))

    # acquisition_status is optional — detect it so a missing field degrades to
    # "link only" instead of crashing the cursor.
    has_status = any(f.name.lower() == "acquisition_status"
                     for f in arcpy.ListFields(parcels_url))
    if not has_status:
        arcpy.AddWarning("Field 'acquisition_status' not found on the parcels layer "
                         "— parcels will be linked but not status-seeded. (If you "
                         "just added it, restart ArcGIS Pro to refresh the schema.)")
    status_fields = ["wayleave_id"] + (["acquisition_status"] if has_status else [])

    unmatched = set()
    parts = []

    # -- 1. Per route source: read this project's lines straight from the
    #       service with a da cursor (which pushes the where to the server —
    #       MakeFeatureLayer validates the where LOCALLY and rejects hosted
    #       feature-service SQL with "ERROR 000358: Invalid expression"),
    #       resolve half-widths, buffer, and collect the polygon. ----------- #
    for i, src in enumerate(ROUTE_SOURCES):
        vfield = src["voltage_field"]
        read_fields = ["SHAPE@"] + ([vfield] if vfield else [])
        rows = []
        with arcpy.da.SearchCursor(
                src["url"], read_fields, sql_equals(REFERENCE_FIELD, reference)) as sc:
            for r in sc:
                rows.append(r)
        arcpy.AddMessage("{}: {} line(s) for {}".format(src["name"], len(rows), reference))
        if not rows:
            continue

        # Build an in-memory line layer carrying just geometry + its half-width.
        lines = "memory/lines_%d" % i
        sr = arcpy.Describe(src["url"]).spatialReference
        arcpy.management.CreateFeatureclass(
            "memory", "lines_%d" % i, "POLYLINE", spatial_reference=sr)
        arcpy.management.AddField(lines, "HALF_M", "DOUBLE")
        with arcpy.da.InsertCursor(lines, ["SHAPE@", "HALF_M"]) as ic:
            for r in rows:
                geom = r[0]
                volt = r[1] if vfield else src["voltage"]
                half = _resolve_half(volt, lut, half_override, unmatched)
                if half is not None:
                    ic.insertRow([geom, half])

        poly = buffer_by_halfwidth(lines, i)
        if poly:
            parts.append(poly)

    if unmatched:
        arcpy.AddWarning("No width rule for voltage(s): {} — those lines were "
                         "skipped.".format(", ".join(sorted(unmatched))))
    if not parts:
        arcpy.AddError("No route lines with a resolvable wayleave width for "
                       "reference '{}'.".format(reference))
        return

    # -- 2. One corridor polygon for the whole project. -------------------- #
    corridor = "memory/corridor"
    if len(parts) == 1:
        arcpy.management.CopyFeatures(parts[0], corridor)
    else:
        merged = "memory/merged_all"
        arcpy.management.Merge(parts, merged)
        arcpy.management.Dissolve(merged, corridor)

    # Match the corridor layer's spatial reference (also used for the parcel hit-test).
    corr_sr = arcpy.Describe(corridor_url).spatialReference
    src_sr = arcpy.Describe(corridor).spatialReference
    if corr_sr and corr_sr.factoryCode and src_sr.factoryCode != corr_sr.factoryCode:
        projected = "memory/corridor_prj"
        arcpy.management.Project(corridor, projected, corr_sr)
        corridor = projected

    # -- 3. Idempotent replace: remove this project's reference from any parcels
    #       it had tagged, then drop its previous corridor. da cursors push the
    #       where to the service (MakeFeatureLayer would reject it locally). --- #
    arcpy.AddMessage("Un-stamping parcels previously tagged with {}...".format(reference))
    with arcpy.da.UpdateCursor(parcels_url, status_fields,
                               like_clause("wayleave_id", reference)) as uc:
        for row in uc:
            ids = parse_ids(row[0])
            if reference in ids:
                ids.remove(reference)
                row[0] = join_ids(ids)
                if has_status and not row[0]:  # left no corridor: clear its status
                    row[1] = None
                uc.updateRow(row)

    arcpy.AddMessage("Removing any previous corridor for {}...".format(reference))
    with arcpy.da.UpdateCursor(corridor_url, ["OID@"],
                               sql_equals("reference_number", reference)) as dc:
        for _ in dc:
            dc.deleteRow()

    # -- 4. Write the corridor (wayleave_id = reference_number). ------------ #
    now = datetime.datetime.now()
    written = 0
    with arcpy.da.SearchCursor(corridor, ["SHAPE@"]) as scur, \
            arcpy.da.InsertCursor(
                corridor_url,
                ["SHAPE@", "wayleave_id", "reference_number", "generation_date"]) as icur:
        for (shape,) in scur:
            icur.insertRow([shape, reference, reference, now])
            written += 1

    # -- 5. Stamp affected parcels: append this reference to the wayleave_id
    #       list and seed acquisition_status when first affected. ----------- #
    parcels_lyr = arcpy.management.MakeFeatureLayer(parcels_url, "parcels")[0]
    arcpy.management.SelectLayerByLocation(parcels_lyr, "INTERSECT", corridor)
    affected = int(arcpy.management.GetCount(parcels_lyr)[0])
    if affected > 0:
        with arcpy.da.UpdateCursor(parcels_lyr, status_fields) as uc:
            for row in uc:
                ids = parse_ids(row[0])
                if reference not in ids:
                    ids.append(reference)
                row[0] = join_ids(ids)
                if has_status and not row[1]:  # seed status, don't clobber existing
                    row[1] = STATUS_DEFAULT
                uc.updateRow(row)

    arcpy.AddMessage("Corridor written for {} ({} feature(s)); {} affected parcel(s)."
                     .format(reference, written, affected))
    arcpy.SetParameter(5, written)
    arcpy.SetParameter(6, affected)
    arcpy.SetParameter(7, corridor)


def _resolve_half(voltage_value, lut, half_override, unmatched):
    """Half-width (m) for a voltage: the override if it is a positive number,
    else width/2 from the rules. Records unmatched voltages, returns None for
    them (so the line is skipped rather than buffered by zero)."""
    try:
        ov = float(half_override)
    except (TypeError, ValueError):
        ov = None
    if ov is not None and ov > 0:
        return ov
    code = normalize_voltage(voltage_value)
    total = lut.get(code) if code else None
    if total is None or total <= 0:
        unmatched.add(str(voltage_value))
        return None
    return total / 2.0


if __name__ == "__main__":
    main()

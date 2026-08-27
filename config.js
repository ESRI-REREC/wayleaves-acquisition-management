/* ---------------------------------------------------------------------------
 * config.js — all environment settings for the Wayleave Acquisition
 * Management UI live here.
 *
 * No credentials in the browser. The username and password live only on the
 * token server (../server, the Next.js app). These pages call `serverUrl` for
 * a short-lived token used to read the secured Projects table and to draw the
 * basemap. Backend writes / corridor generation will also go through that
 * server. See README.md.
 * ------------------------------------------------------------------------- */

window.APP_CONFIG = {
  portalUrl: "https://development.esriea.com/portal",
  serverRestUrl: "https://development.esriea.com/server/rest/services",

  // The Projects hosted table (non-spatial). Row per wayleave project.
  projectsLayerUrl:
    "https://development.esriea.com/server/rest/services/Hosted/Projects/FeatureServer/0",

  // Parcels polygon layer (Wayleaves service). Shown on the corridor map as the
  // default backdrop until a wayleave corridor has been generated.
  parcelsLayerUrl:
    "https://development.esriea.com/server/rest/services/Hosted/Wayleaves/FeatureServer/0",

  // Token server (../server). Holds the credentials and exposes GET /api/token.
  // No trailing slash. Swap this for your local Next.js dev server
  // (e.g. "http://localhost:3000") when running the backend yourself.
  //
  // NOTE: the token is *referer-bound*. The server mints it against its
  // ARCGIS_REFERER origin, so the browser must be served from that same origin
  // for direct layer reads to succeed. The deployed server below is bound to
  // http://localhost:3000, so serve these pages from http://localhost:3000
  // (or set ARCGIS_REFERER + ALLOWED_ORIGINS on your own server to match).
  serverUrl: "https://dev-server-rerec-poc.vercel.app",

  // Nairobi / Westlands — where the corridor map opens.
  initialCenter: [36.79037290204911, -1.2597187025957526],
  initialZoom: 16,

  // Extent of Kenya (Web Mercator / wkid 102100). The corridor map opens to
  // this when no wayleave corridor has been generated yet.
  kenyaExtent: {
    xmin: 3760000,
    ymin: -560000,
    xmax: 4690000,
    ymax: 610000,
    spatialReference: { wkid: 102100, latestWkid: 3857 }
  },

  // Imagery basemap to match the reference design (satellite + labels).
  // Or "portal-default" to use the org's configured basemap, or any well-known
  // id: "topo-vector", "streets-vector", "hybrid", "satellite", "gray-vector".
  basemap: "hybrid",

  /* Columns rendered in the projects table, in order. Every `field` must exist
   * on the service. `label` overrides the field alias in the header. The page
   * appends an "Open" action icon after the last column. */
  projectColumns: [
    { field: "name", label: "Project Name", width: 200 },
    { field: "reference_number", label: "Reference No.", width: 150 },
    { field: "implementation_status", label: "Implementation Status", width: 160 },
    { field: "funding_year", label: "Funding Year", width: 120 },
    { field: "initiator_category", label: "Initiator Category", width: 170 },
    { field: "funding_category", label: "Funding Category", width: 180 }
  ],

  /* Fields shown on the details page Overview tab, in order. */
  overviewFields: [
    { field: "reference_number", label: "Reference Number" },
    { field: "implementation_status", label: "Implementation Status" },
    { field: "funding_year", label: "Funding Year" },
    { field: "initiator_category", label: "Initiator Category" },
    { field: "funding_category", label: "Funding Category" }
  ]
};

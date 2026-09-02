/* ---------------------------------------------------------------------------
 * config.js — all environment settings for the Wayleave Acquisition
 * Management UI live here.
 *
 * No credentials in the browser. Wayleave officers sign in with their own
 * ArcGIS portal account via OAuth 2.0 (oauth.js); the SDK's IdentityManager then
 * attaches the user's token to every secured request (reading the Projects table,
 * the parcels/asset layers, and the basemap). See README.md.
 * ------------------------------------------------------------------------- */

window.APP_CONFIG = {
	portalUrl: "https://development.esriea.com/portal",
	serverRestUrl: "https://development.esriea.com/server/rest/services",

	// OAuth 2.0 app id (client_id) for named-user sign-in. Register a *browser*
	// app in the portal whose redirect URIs include this app's serving origin(s),
	// then paste its App ID here. Wayleave officers sign in with their own portal
	// account (oauth.js) — replaces the old token-server auth.
	oauthAppId: "Et0OpBv9mct0ZcVG",

	// The Projects hosted table (non-spatial). Row per wayleave project.
	projectsLayerUrl:
		"https://development.esriea.com/server/rest/services/Hosted/electrification_projects/FeatureServer/0",

	// Base filter for the projects table: only projects that have reached the
	// Wayleave Acquisition stage. Column filters are AND-ed on top of this.
	projectsWhere: "implementation_status = 'Wayleave Acquisition'",

	// Parcels polygon layer (Wayleaves service). Shown on the corridor map as the
	// default backdrop until a wayleave corridor has been generated.
	parcelsLayerUrl:
		"https://development.esriea.com/server/rest/services/Hosted/Wayleaves/FeatureServer/0",

	// Survey & Design Assets feature service — every sublayer is added to the
	// corridor map (toggled via the layer list).
	assetsServiceUrl:
		"https://development.esriea.com/server/rest/services/Hosted/Survey_and_Design_Assets/FeatureServer",
	// Portal ITEM for that service. Sublayers are loaded from the item (not the
	// raw service url) so they inherit the symbology saved on the item's
	// visualization — the FeatureServer's own drawingInfo is the plain default.
	assetsItemId: "10ee7f0af04f49288240eb8a1c12a6f5",
	// Asset sublayers whose name starts with one of these prefixes start hidden on
	// the corridor map: the suggested_* design outputs and the existing* base layers.
	mapHiddenLayerPrefixes: ["suggested_", "existing"],

	// Facilities layer — the corridor map zooms to the facility point whose
	// reference_number matches the project's.
	facilitiesLayerUrl:
		"https://development.esriea.com/server/rest/services/Hosted/Facilities/FeatureServer/0",
	// Zoom level used when framing the associated facility point.
	mapFacilityZoom: 17,

	// The "Digitize parcels" button opens this feature item's overview page in a
	// new tab (item.html = the portal item's overview). Replace the id below with
	// the real feature item id once you have it.
	digitizeParcelsUrl:
		"https://development.esriea.com/portal/home/item.html?id=REPLACE_WITH_ITEM_ID",

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
		{ field: "project_name", label: "Project Name", width: 200 },
		{ field: "project_reference_number", label: "Reference No.", width: 150 },
		{ field: "funding_year", label: "Funding Year", width: 120 },
		{ field: "initiator_category", label: "Initiator Category", width: 170 },
		{ field: "funding_category", label: "Funding Category", width: 180 }
	],

	/* Overview tab panels. Each section renders as a collapsible calcite-block
	 * with its fields as a definition list, in order. Date fields are detected
	 * from the layer schema and formatted automatically. */
	overviewSections: [
		{
			title: "Project Details",
			icon: "information",
			fields: [
				{ field: "project_reference_number", label: "Reference Number" },
				{ field: "implementation_status", label: "Implementation Status" },
				{ field: "funding_year", label: "Funding Year" },
				{ field: "initiator_category", label: "Initiator Category" },
				{ field: "funding_category", label: "Funding Category" }
			]
		},
		{
			title: "Survey Details",
			icon: "compass",
			fields: [
				{ field: "surveyed_by", label: "Surveyed By" },
				{ field: "survey_completion_date", label: "Survey Completion Date" },
				{ field: "survey_approved_by", label: "Survey Approved By" },
				{ field: "survey_approved_date", label: "Survey Approved Date" }
			]
		},
		{
			title: "Design Details",
			icon: "pencil",
			fields: [
				{ field: "designed_by", label: "Designed By" },
				{ field: "design_completion_date", label: "Design Completion Date" },
				{ field: "design_approved_by", label: "Design Approved By" },
				{ field: "design_approved_date", label: "Design Approved Date" }
			]
		},
		{
			title: "Cartography Details",
			icon: "map",
			fields: [
				{ field: "cartography_by", label: "Cartography By" },
				{
					field: "cartography_completion_date",
					label: "Cartography Completion Date"
				},
				{ field: "cartography_approved_by", label: "Cartography Approved By" },
				{
					field: "cartography_approval_date",
					label: "Cartography Approval Date"
				}
			]
		}
	]
};

/* ---------------------------------------------------------------------------
 * oauth.js — named-user sign-in for the Wayleave Acquisition Management UI.
 *
 * Replaces the shared token-server auth for this app: the wayleave officer signs
 * in with their own ArcGIS portal account (OAuth 2.0), so we know who they are.
 * The SDK's IdentityManager then attaches the user's token to every secured
 * request (reads + edits), and — because OAuth tokens are not referer-bound —
 * this works from any registered origin.
 *
 * Requires config.oauthAppId: a *browser* app registered in the portal whose
 * redirect URIs include this app's serving origin.
 * ------------------------------------------------------------------------- */

import OAuthInfo from "https://js.arcgis.com/4.31/@arcgis/core/identity/OAuthInfo.js";
import esriId from "https://js.arcgis.com/4.31/@arcgis/core/identity/IdentityManager.js";

const CFG = window.APP_CONFIG;

/** localStorage key for persisting the signed-in credential across page loads
 * (so navigating list → project doesn't re-run the OAuth redirect each time). */
const STORE_KEY = "wayleave_esri_auth";

let _username = null;
let _registered = false;

function sharingUrl() {
  return CFG.portalUrl + "/sharing";
}

function restoreCredentials() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) esriId.initialize(JSON.parse(saved));
  } catch (_) {
    /* ignore corrupt/absent state */
  }
}

function persistCredentials() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(esriId.toJSON()));
  } catch (_) {
    /* storage may be unavailable */
  }
}

/** Ensure the user is signed in. Returns their portal username. Redirects to the
 * portal login on first sign-in (silently returns if a portal session exists). */
export async function ensureSignedIn() {
  if (!CFG.oauthAppId || CFG.oauthAppId.startsWith("REPLACE")) {
    throw new Error(
      "OAuth is not configured. Set config.oauthAppId to a registered browser app id."
    );
  }

  if (!_registered) {
    esriId.registerOAuthInfos([
      new OAuthInfo({ appId: CFG.oauthAppId, portalUrl: CFG.portalUrl, popup: false })
    ]);
    _registered = true;
  }

  restoreCredentials();

  let credential;
  try {
    credential = await esriId.checkSignInStatus(sharingUrl());
  } catch (_) {
    credential = await esriId.getCredential(sharingUrl()); // full-page redirect
  }

  persistCredentials();
  _username = (credential && credential.userId) || null;
  return _username;
}

export function getUsername() {
  return _username;
}

/** A federated ArcGIS Server token, for building attachment URLs / raw service
 * fetches that need a token in the query string. */
export async function getServerToken() {
  const credential = await esriId.getCredential(CFG.serverRestUrl);
  return credential.token;
}

/** Sign out and clear the persisted credential. */
export function signOut() {
  esriId.destroyCredentials();
  try {
    localStorage.removeItem(STORE_KEY);
  } catch (_) {}
  window.location.reload();
}

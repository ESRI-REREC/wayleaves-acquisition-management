/* ---------------------------------------------------------------------------
 * auth.js — shared token handling for every page.
 *
 * Fetches a short-lived portal token from the token server (../server) and
 * registers it with the ArcGIS SDK's IdentityManager so secured layer reads
 * are authenticated. The credentials never reach the browser.
 *
 * Usage:
 *   await Auth.mint();                 // get a token
 *   Auth.setIdentityManager(esriId);   // hand the SDK its IdentityManager
 *   await Auth.valid();                // token guaranteed fresh for >1 min
 * ------------------------------------------------------------------------- */

window.Auth = (function () {
  "use strict";

  const CFG = window.APP_CONFIG;

  let token = null;
  let expires = 0; // epoch ms
  let esriId = null;

  /** Fetch a fresh token from the server. Throws on failure. */
  async function mint() {
    const res = await fetch(CFG.serverUrl + "/api/token");
    const json = await res.json();

    if (!json.token) {
      throw new Error("Could not sign in: " + (json.error || "unknown error"));
    }

    token = json.token;
    expires = json.expires;
    register();
    return token;
  }

  /** Give this module the SDK's IdentityManager so it can register tokens. */
  function setIdentityManager(id) {
    esriId = id;
    register();
  }

  /** Register the current token for the portal + server origins. */
  function register() {
    if (!esriId || !token) return;
    [CFG.serverRestUrl, CFG.portalUrl + "/sharing/rest"].forEach((server) => {
      esriId.registerToken({ server, token, expires });
    });
  }

  /** Return a token valid for at least another minute, re-minting if needed. */
  async function valid() {
    if (!token || Date.now() > expires - 60_000) {
      await mint();
    }
    return token;
  }

  return {
    mint,
    valid,
    setIdentityManager,
    register,
    get token() {
      return token;
    },
    get expires() {
      return expires;
    }
  };
})();

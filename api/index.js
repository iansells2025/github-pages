"use strict";

/* Vercel entry point. Every /api/* request is rewritten here (see vercel.json)
   and handed to the same Express app the standalone server runs, so there is
   one code path and one set of tests behind both.

   `boot()` connects to Postgres and builds the app. It is cached per instance:
   a warm lambda reuses the connection pool rather than dialling per request. */

const { boot } = require("../server/src/server.js");

let appPromise = null;

async function getApp() {
  if (!appPromise) {
    appPromise = boot().catch((err) => {
      // Don't cache a failed boot — the next request should get a fresh attempt
      // rather than being stuck behind a transient database error forever.
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

module.exports = async function handler(req, res) {
  try {
    const app = await getApp();

    // Depending on how the rewrite resolves, the function can be invoked with
    // the path already stripped of its /api prefix. The Express routes are all
    // declared with it, so put it back when it is missing.
    if (req.url && !req.url.startsWith("/api")) {
      req.url = "/api" + (req.url.startsWith("/") ? "" : "/") + req.url;
    }

    return app(req, res);
  } catch (err) {
    console.error("failed to handle request", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Something went wrong on our end." }));
  }
};

/* Stripe's webhook signature is computed over the exact request bytes, so the
   platform must not parse the body before the app sees it. */
module.exports.config = {
  api: { bodyParser: false }
};

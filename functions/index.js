const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const next = require("next");

const SENTINEL_ID = defineSecret("SENTINEL_HUB_CLIENT_ID");
const SENTINEL_SECRET = defineSecret("SENTINEL_HUB_CLIENT_SECRET");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, conf: { distDir: ".next" } });
const handle = app.getRequestHandler();

exports.nextjsServer = onRequest({ secrets: [SENTINEL_ID, SENTINEL_SECRET], memory: "512Mi", concurrency: 80 }, (req, res) => {
  return app.prepare().then(() => handle(req, res));
});

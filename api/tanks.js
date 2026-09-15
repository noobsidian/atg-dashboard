// api/tanks.js
//
// Read-only endpoint for the dashboard UI. Unlike the old proxy, this never
// calls the OMNTEC units directly — it just returns whatever the VM poller
// last pushed to KV. This is why it's immune to the EJ Ward IP allowlisting
// issue: this function's outbound IP no longer matters, because it makes no
// outbound calls to the units at all.
//
// Response shape is a bare JSON array, matching the original api/tanks.js
// exactly, so index.html and vendor.html work against this with zero
// front-end changes. Staleness info is passed via response headers instead
// of the body, to avoid changing that shape.

const { kv } = require("@vercel/kv");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const isVendor = req.query && req.query.vendor === "1";

  if (!isVendor) {
    const expectedToken = process.env.DASHBOARD_TOKEN;
    const providedToken = req.query && req.query.token;
    if (expectedToken && providedToken !== expectedToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const payload = await kv.get("atg:latest");

  if (!payload) {
    res.status(503).json({ error: "No data yet — poller hasn't pushed anything" });
    return;
  }

  const ageMs = Date.now() - new Date(payload.polledAt).getTime();
  const staleAfterMs = 5 * 60 * 1000; // flag stale if older than 5 minutes
  res.setHeader("X-Data-Age-Ms", String(ageMs));
  res.setHeader("X-Data-Stale", ageMs > staleAfterMs ? "true" : "false");

  let results = payload.sites;

  if (isVendor) {
    // Matches production's vendor scrubbing: strip IPs/backup info and
    // alarm details, keep name/addr/error/invHtml/cgiData only.
    results = results.map((r) => ({
      name: r.name,
      addr: r.addr,
      error: r.error,
      alarms: [],
      invHtml: r.invHtml,
      cgiData: r.cgiData,
    }));
  }

  res.status(200).json(results);
};

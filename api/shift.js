// api/shift.js
//
// Same weekday-consumption-averaging logic as the original production
// shift.js. The only change: instead of POSTing to the unit directly from
// Vercel (which breaks under EJ Ward's IP allowlisting, since Vercel has
// no static outbound IP), this now POSTs to the small relay server running
// on the Oracle VM — which has the whitelisted static IP and forwards the
// request on to the real unit.

const SITES = [
  { name: "Central Operations FMO",        url: "http://63.46.75.214:10001" },
  { name: "Northeast Remote Ops FMO",       url: "http://166.146.80.90:10001" },
  { name: "Heavy Equipment Shop FMO",       url: "http://63.46.75.226:10001" },
  { name: "Public Utilities Field Ops RW",  url: "http://63.46.75.230:10001" },
  { name: "Wilders Grove SWS",              url: "http://63.46.75.218:10001" },
  { name: "Marsh Creek PRCR",              url: "http://63.46.75.228:10001" },
  { name: "Neuse River NRRF RW",           url: "http://63.46.75.227:10001" },
];

const RELAY_URL = process.env.RELAY_URL;
const RELAY_SECRET = process.env.RELAY_SECRET;
const TIMEOUT_MS = 20000;

async function fetchViaRelay(targetUrl, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RELAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Secret": RELAY_SECRET,
      },
      body: JSON.stringify({ url: targetUrl, body }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Relay HTTP ${res.status}: ${text}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (!RELAY_URL || !RELAY_SECRET) {
    res.status(200).json({ ok: false, error: "Relay not configured" });
    return;
  }

  const expectedToken = process.env.DASHBOARD_TOKEN;
  const providedToken = req.query && req.query.token;
  if (expectedToken && providedToken !== expectedToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const siteParam = req.query && req.query.site;
  const tankParam = req.query && req.query.tank;

  if (siteParam === undefined || tankParam === undefined) {
    res.status(400).json({ error: "site and tank params required" });
    return;
  }

  const idx = parseInt(siteParam, 10);
  if (isNaN(idx) || idx < 0 || idx >= SITES.length) {
    res.status(400).json({ error: "Invalid site index" });
    return;
  }

  const site = SITES[idx];

  const startDate = daysAgo(28);
  const endDate = daysAgo(0);
  const body = `tank=${encodeURIComponent(tankParam)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;

  try {
    const raw = await fetchViaRelay(site.url + "/php/getShift.php", body);
    const data = JSON.parse(raw);

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekdayData = {};

    data.forEach((row) => {
      const diff = parseFloat(row.prodvoldiff || 0);
      if (diff >= -10) return;

      const tmstart = parseInt(row.tmstart, 10);
      if (!tmstart) return;
      const date = new Date(tmstart * 1000);
      const dow = date.getDay();

      const consumed = Math.abs(diff);
      if (!weekdayData[dow]) weekdayData[dow] = {};

      const dateKey = date.toISOString().split("T")[0];
      if (!weekdayData[dow][dateKey]) weekdayData[dow][dateKey] = 0;
      weekdayData[dow][dateKey] += consumed;
    });

    const result = {};
    for (let dow = 0; dow < 7; dow++) {
      const dates = weekdayData[dow];
      if (!dates) {
        result[dayNames[dow]] = null;
        continue;
      }
      const sorted = Object.entries(dates)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 3)
        .map(([, v]) => v);
      const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
      result[dayNames[dow]] = { avg, periods: sorted.length };
    }

    res.status(200).json({ ok: true, data: result });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message });
  }
};

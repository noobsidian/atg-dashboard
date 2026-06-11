const http = require('http');
const https = require('https');

const SITES = [
  { name: "Central Operations FMO",        url: "http://63.46.75.214:10001" },
  { name: "Northeast Remote Ops FMO",       url: "http://166.146.80.90:10001" },
  { name: "Heavy Equipment Shop FMO",       url: "http://63.46.75.226:10001" },
  { name: "Public Utilities Field Ops RW",  url: "http://63.46.75.230:10001" },
  { name: "Wilders Grove SWS",              url: "http://63.46.75.218:10001" },
  { name: "Marsh Creek PRCR",              url: "http://63.46.75.228:10001" },
  { name: "Neuse River NRRF RW",           url: "http://63.46.75.227:10001" },
];

const TIMEOUT_MS = 20000;

function postUrl(url, body, timeoutMs) {
  const t = timeoutMs || TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const urlObj = new (require('url').URL)(url);
    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port,
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'ATG-Dashboard/1.0',
      },
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.setTimeout(t, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Build a date string YYYY-MM-DD N days ago
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Token check
  const expectedToken = process.env.DASHBOARD_TOKEN;
  const providedToken = req.query && req.query.token;
  if (expectedToken && providedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const siteParam = req.query && req.query.site;
  const tankParam = req.query && req.query.tank;

  if (siteParam === undefined || tankParam === undefined) {
    return res.status(400).json({ error: 'site and tank params required' });
  }

  const idx = parseInt(siteParam, 10);
  if (isNaN(idx) || idx < 0 || idx >= SITES.length) {
    return res.status(400).json({ error: 'Invalid site index' });
  }

  const site = SITES[idx];

  // Fetch 28 days of shift data to get 3 occurrences of each weekday
  const startDate = daysAgo(28);
  const endDate   = daysAgo(0);
  const body = `tank=${encodeURIComponent(tankParam)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;

  try {
    const raw  = await postUrl(site.url + '/php/getShift.php', body);
    const data = JSON.parse(raw);

    // Process shift rows into daily consumption per weekday
    // prodvoldiff < -10 = real consumption (excludes temp noise)
    // prodvoldiff > 0   = delivery, excluded
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekdayData = {}; // { 0: [gallons,...], 1: [...], ... }

    data.forEach(row => {
      const diff = parseFloat(row.prodvoldiff || 0);
      if (diff >= -10) return; // exclude deliveries and noise

      // Use the start time to determine which calendar day this shift belongs to
      const tmstart = parseInt(row.tmstart, 10);
      if (!tmstart) return;
      const date = new Date(tmstart * 1000);
      const dow  = date.getDay(); // 0=Sun, 1=Mon, ...

      // Use absolute value of consumption
      const consumed = Math.abs(diff);
      if (!weekdayData[dow]) weekdayData[dow] = {};

      // Group by calendar date so we sum all shifts in the same day
      const dateKey = date.toISOString().split('T')[0];
      if (!weekdayData[dow][dateKey]) weekdayData[dow][dateKey] = 0;
      weekdayData[dow][dateKey] += consumed;
    });

    // Average the last 3 occurrences of each weekday
    const result = {};
    for (let dow = 0; dow < 7; dow++) {
      const dates = weekdayData[dow];
      if (!dates) { result[dayNames[dow]] = null; continue; }
      // Sort dates descending, take up to 3
      const sorted = Object.entries(dates)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 3)
        .map(([, v]) => v);
      const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
      result[dayNames[dow]] = { avg, periods: sorted.length };
    }

    return res.status(200).json({ ok: true, data: result });
  } catch(e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};

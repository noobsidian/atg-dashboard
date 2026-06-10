const https = require('https');
const http  = require('http');

const SITES = [
  { name: "Central Operations FMO",        addr: "2540 Westinghouse Blvd", url: "http://63.46.75.214:10001" },
  { name: "Northeast Remote Ops FMO",       addr: "7702 Burwell St",        url: "http://166.146.80.90:10001" },
  { name: "Heavy Equipment Shop FMO",       addr: "4120 New Bern Ave",       url: "http://63.46.75.226:10001" },
  { name: "Public Utilities Field Ops RW",  addr: "3304 Lake Woodard Dr",   url: "http://63.46.75.230:10001" },
  { name: "Wilders Grove SWS",              addr: "610 Beacon Lake Dr",     url: "http://63.46.75.218:10001" },
  { name: "Marsh Creek PRCR",              addr: "4225 Daly Rd",            url: "http://63.46.75.228:10001" },
  { name: "Neuse River NRRF RW",           addr: "8500 Battle Bridge Rd",   url: "http://63.46.75.227:10001" },
];

const TIMEOUT_MS = 28000;

function fetchUrl(url, timeoutMs) {
  const t = timeoutMs || TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'ATG-Dashboard/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.setTimeout(t, () => { req.destroy(); reject(new Error('Timeout after ' + t + 'ms')); });
    req.on('error', reject);
  });
}

async function fetchSite(site) {
  const result = { name: site.name, addr: site.addr, url: site.url, tanks: [], alarms: [], error: null, cgiData: null, invHtml: null };
  try {
    const [cgiRaw, invHtml] = await Promise.all([
      fetchUrl(site.url + '/cgi-bin/getTankData.cgi?dataset=dynData'),
      fetchUrl(site.url + '/php/Inventory.php'),
    ]);
    try { result.cgiData = JSON.parse(cgiRaw); } catch(e) { throw new Error('Invalid JSON from CGI'); }
    result.invHtml = invHtml;
    if (!result.cgiData || !result.cgiData.tankData) throw new Error('No tank data');
    try {
      const alarmRaw = await fetchUrl(site.url + '/php/getAlarms.php?current=1', 10000);
      result.alarms = JSON.parse(alarmRaw);
    } catch(e) { result.alarms = []; }
  } catch(e) { result.error = e.message; }
  return result;
}

function scrubForVendor(r) {
  return { name: r.name, addr: r.addr, error: r.error, alarms: [], invHtml: r.invHtml, cgiData: r.cgiData };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const isVendor = req.query && req.query.vendor === '1';

  if (!isVendor) {
    const expectedToken = process.env.DASHBOARD_TOKEN;
    const providedToken = req.query && req.query.token;
    if (expectedToken && providedToken !== expectedToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // ?site=N — fetch single site for progressive loading
  const siteParam = req.query && req.query.site;
  if (siteParam !== undefined) {
    const idx = parseInt(siteParam, 10);
    if (isNaN(idx) || idx < 0 || idx >= SITES.length) return res.status(400).json({ error: 'Invalid site index' });
    const result = await fetchSite(SITES[idx]);
    return res.status(200).json(isVendor ? scrubForVendor(result) : result);
  }

  // Fetch all (legacy fallback)
  const results = await Promise.all(SITES.map(fetchSite));
  if (isVendor) return res.status(200).json(results.map(scrubForVendor));
  res.status(200).json(results);
};

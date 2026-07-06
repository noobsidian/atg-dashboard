const https = require('https');
const http = require('http');

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

async function fetchSite(site, backupIp) {
  const result = { name: site.name, addr: site.addr, url: site.url, tanks: [], alarms: [], error: null, cgiData: null, invHtml: null, usingBackup: false };

  async function tryUrl(baseUrl) {
    const [cgiRaw, invHtml] = await Promise.all([
      fetchUrl(baseUrl + '/cgi-bin/getTankData.cgi?dataset=dynData'),
      fetchUrl(baseUrl + '/php/Inventory.php'),
    ]);
    let cgiData;
    try { cgiData = JSON.parse(cgiRaw); } catch(e) { throw new Error('Invalid JSON from CGI'); }
    if (!cgiData || !cgiData.tankData) throw new Error('No tank data');
    let alarms = [];
    try {
      const alarmRaw = await fetchUrl(baseUrl + '/php/getAlarms.php?current=1', 10000);
      alarms = JSON.parse(alarmRaw);
    } catch(e) { alarms = []; }
    return { cgiData, invHtml, alarms };
  }

  try {
    // Try primary URL first
    const data = await tryUrl(site.url);
    result.cgiData  = data.cgiData;
    result.invHtml  = data.invHtml;
    result.alarms   = data.alarms;
  } catch(primaryErr) {
    // Primary failed — try backup IP if provided
    if (backupIp) {
      try {
        const backupUrl = 'http://' + backupIp + ':10001';
        const data = await tryUrl(backupUrl);
        result.cgiData     = data.cgiData;
        result.invHtml     = data.invHtml;
        result.alarms      = data.alarms;
        result.usingBackup = true;
        result.backupUrl   = backupUrl;
      } catch(backupErr) {
        result.error = 'Primary: ' + primaryErr.message + ' | Backup: ' + backupErr.message;
      }
    } else {
      result.error = primaryErr.message;
    }
  }

  return result;
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

  // Parse backup IPs from query: &backup_0=x.x.x.x&backup_2=y.y.y.y
  const backupIps = {};
  if (req.query) {
    Object.keys(req.query).forEach(k => {
      const m = k.match(/^backup_(\d+)$/);
      if (m) {
        const ip = req.query[k];
        // Basic IP validation
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) backupIps[parseInt(m[1])] = ip;
      }
    });
  }

  // Support ?site=N for progressive loading
  const siteParam = req.query && req.query.site;
  if (siteParam !== undefined) {
    const idx = parseInt(siteParam, 10);
    if (isNaN(idx) || idx < 0 || idx >= SITES.length) return res.status(400).json({ error: 'Invalid site index' });
    const result = await fetchSite(SITES[idx], backupIps[idx]);
    return res.status(200).json(result);
  }

  const results = await Promise.all(SITES.map((site, i) => fetchSite(site, backupIps[i])));

  if (isVendor) {
    const scrubbed = results.map(r => ({
      name:    r.name,
      addr:    r.addr,
      error:   r.error,
      alarms:  [],
      invHtml: r.invHtml,
      cgiData: r.cgiData,
    }));
    return res.status(200).json(scrubbed);
  }

  res.status(200).json(results);
};

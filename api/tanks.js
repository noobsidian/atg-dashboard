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

const TIMEOUT_MS = 20000;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'ATG-Dashboard/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

async function fetchSite(site) {
  const result = { name: site.name, addr: site.addr, url: site.url, tanks: [], alarms: [], error: null, cgiData: null, invHtml: null };
  try {
    const [cgiRaw, invHtml, alarmRaw] = await Promise.all([
      fetchUrl(site.url + '/cgi-bin/getTankData.cgi?dataset=dynData'),
      fetchUrl(site.url + '/php/Inventory.php'),
      fetchUrl(site.url + '/php/getAlarms.php?current=1').catch(() => '[]'),
    ]);

    try { result.cgiData = JSON.parse(cgiRaw); } catch(e) { throw new Error('Invalid JSON from CGI'); }
    result.invHtml = invHtml;
    try { result.alarms = JSON.parse(alarmRaw); } catch(e) { result.alarms = []; }
    if (!result.cgiData || !result.cgiData.tankData) throw new Error('No tank data');

  } catch(e) {
    result.error = e.message;
  }
  return result;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Each site handled independently — one failure won't crash the whole response
  const results = await Promise.all(SITES.map(fetchSite));
  res.status(200).json(results);
};

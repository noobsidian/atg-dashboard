const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

const BIN_ID     = '6a0e0b4b6877513b27a5985b';
const MASTER_KEY = '$2a$10$rkNwXnIOnckRir5fSmQnieRdRisUG4POtdRQ2yQJRu93ZVUR0PTbC';
const BIN_URL    = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

async function readBin() {
  const resp = await fetch(BIN_URL + '/latest', {
    headers: { 'X-Master-Key': MASTER_KEY }
  });
  if (!resp.ok) throw new Error('Read failed: ' + resp.status);
  const data = await resp.json();
  return data.record || { flags: {} };
}

async function writeBin(record, retries = 3) {
  for (let i = 0; i < retries; i++) {
    // Always re-read before writing to avoid overwriting concurrent changes
    let current;
    try { current = await readBin(); } catch(e) { current = { flags: {} }; }
    // Merge incoming record flags over current flags
    const merged = { flags: { ...current.flags, ...record.flags } };
    
    const resp = await fetch(BIN_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': MASTER_KEY,
      },
      body: JSON.stringify(merged),
    });
    if (resp.ok) return;
    if (i < retries - 1) await new Promise(r => setTimeout(r, 300 * (i + 1)));
  }
  throw new Error('Write failed after retries');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  const key = req.query.key;

  try {
    if (req.method === 'GET') {
      const record = await readBin();
      if (key) {
        return res.status(200).json({ key, value: record.flags[key] || null });
      }
      return res.status(200).json(record.flags || {});
    }

    if (req.method === 'POST') {
      const body   = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      // writeBin does a fresh read internally so just pass the single flag to merge
      await writeBin({ flags: { [key]: { flagDate: body.flagDate, orderedBy: body.orderedBy || 'User' } } });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const record = await readBin();
      delete record.flags[key];
      // Pass full record for delete since we need to remove a key
      const resp = await fetch(BIN_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': MASTER_KEY },
        body: JSON.stringify(record),
      });
      if (!resp.ok) throw new Error('Delete failed: ' + resp.status);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch(e) {
    console.error('JSONBin error:', e);
    if (req.method === 'GET') return res.status(200).json({});
    return res.status(200).json({ ok: false, error: e.message });
  }
}

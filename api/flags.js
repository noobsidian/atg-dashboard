import { kv } from '@vercel/kv';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  const key = req.query.key; // format: siteUrl|tankId

  try {
    if (req.method === 'GET') {
      // Get all flags or a specific one
      if (key) {
        const val = await kv.get('flag:' + key);
        return res.status(200).json({ key, value: val });
      } else {
        // Return all flags
        const keys = await kv.keys('flag:*');
        const flags = {};
        if (keys.length > 0) {
          const values = await Promise.all(keys.map(k => kv.get(k)));
          keys.forEach((k, i) => {
            flags[k.replace('flag:', '')] = values[i];
          });
        }
        return res.status(200).json(flags);
      }
    }

    if (req.method === 'POST') {
      // Set a flag
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { flagDate, orderedBy } = body;
      await kv.set('flag:' + key, { flagDate, orderedBy: orderedBy || 'User' });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      // Clear a flag
      await kv.del('flag:' + key);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    console.error('KV error:', e);
    return res.status(500).json({ error: e.message });
  }
}

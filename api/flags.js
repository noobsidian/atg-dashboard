const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

const GIST_ID    = '2881d8cf8a9645f55f9b8d0c8d1dc120';
const GIST_TOKEN = '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';
const GIST_FILE  = 'flags.json';
const GIST_URL   = `https://api.github.com/gists/${GIST_ID}`;

const HEADERS = {
  'Authorization': `token ${GIST_TOKEN}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'ATG-Dashboard/1.0',
};

async function readGist() {
  const resp = await fetch(GIST_URL, { headers: HEADERS });
  if (!resp.ok) throw new Error('Gist read failed: ' + resp.status);
  const data = await resp.json();
  const content = data.files[GIST_FILE]?.content || '{"flags":{}}';
  return JSON.parse(content);
}

async function writeGist(record) {
  const resp = await fetch(GIST_URL, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: { [GIST_FILE]: { content: JSON.stringify(record) } }
    }),
  });
  if (!resp.ok) throw new Error('Gist write failed: ' + resp.status);
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
      const record = await readGist();
      if (key) return res.status(200).json({ key, value: record.flags?.[key] || null });
      return res.status(200).json(record.flags || {});
    }

    if (req.method === 'POST') {
      const body   = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const record = await readGist();
      record.flags        = record.flags || {};
      record.flags[key]   = { flagDate: body.flagDate, orderedBy: body.orderedBy || 'User' };
      await writeGist(record);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const record = await readGist();
      record.flags = record.flags || {};
      delete record.flags[key];
      await writeGist(record);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch(e) {
    console.error('Gist error:', e);
    if (req.method === 'GET') return res.status(200).json({});
    return res.status(200).json({ ok: false, error: e.message });
  }
}

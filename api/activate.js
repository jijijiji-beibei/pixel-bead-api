module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawKey = (req.body && req.body.key) || '';
  const key = String(rawKey).trim().toUpperCase();

  if (!key) {
    return res.status(400).json({ success: false, error: 'Missing key' });
  }

  const kvUrl = (process.env.TEST_KV_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
  const kvToken = process.env.KV_REST_API_TOKEN || '';

  if (!kvUrl || !kvToken) {
    return res.status(500).json({ success: false, error: 'KV not configured' });
  }

  async function kvGet(k) {
    const r = await fetch(kvUrl + '/get/' + encodeURIComponent(k), {
      headers: { Authorization: 'Bearer ' + kvToken },
      signal: AbortSignal.timeout(5000)
    });
    const d = await r.json();
    return d.result === undefined ? null : d.result;
  }

  async function kvSet(k, v) {
    await fetch(kvUrl + '/set/' + encodeURIComponent(k), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + kvToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(v),
      signal: AbortSignal.timeout(5000)
    });
  }

  async function kvExpire(k, ttl) {
    await fetch(kvUrl + '/expire/' + encodeURIComponent(k) + '/' + ttl, {
      headers: { Authorization: 'Bearer ' + kvToken },
      signal: AbortSignal.timeout(5000)
    });
  }

  try {
    // Step 1: Check whitelist
    const whitelisted = await kvGet('valid:' + key);
    if (whitelisted === null) {
      // Also try fallback lowercase
      const fb = await kvGet('valid:' + key.toLowerCase());
      if (fb === null) {
        return res.status(200).json({ success: false, error: 'invalid_key', message: '密钥不在白名单中' });
      }
    }

    // Step 2: Set activation timestamp (this starts the 24h countdown)
    const now = Date.now();
    await kvSet('activation:' + key, now);
    await kvExpire('activation:' + key, 60 * 60 * 24 * 30); // 30 days cleanup

    return res.status(200).json({
      success: true,
      message: '密钥激活成功',
      activatedAt: now,
      validUntil: now + 24 * 60 * 60 * 1000
    });
  } catch (error) {
    console.error('[activate] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal error', detail: error.message });
  }
};

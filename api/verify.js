const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  console.log('[verify] Received request, method:', req.method);

  if (req.method !== 'POST') {
    console.log('[verify] Rejected: method not allowed');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { key } = req.body || {};
  console.log('[verify] Key received:', key ? key.substring(0, 4) + '...' : 'none');

  if (!key || typeof key !== 'string') {
    console.log('[verify] Rejected: missing key');
    return res.status(400).json({ error: 'Missing key' });
  }

  try {
    // Check KV_REST_API_URL env var
    console.log('[verify] KV_REST_API_URL set:', !!process.env.KV_REST_API_URL);
    console.log('[verify] KV_REST_API_TOKEN set:', !!process.env.KV_REST_API_TOKEN);

    // Step 1: Whitelist check
    console.log('[verify] Querying valid:' + key);
    const whitelisted = await kv.get('valid:' + key);
    console.log('[verify] Whitelist result:', whitelisted);

    if (whitelisted === null) {
      console.log('[verify] Key not in whitelist, rejecting');
      return res.status(200).json({ valid: false, reason: 'invalid_key' });
    }

    // Step 2: Activation check
    console.log('[verify] Querying activation:' + key);
    const activation = await kv.get('activation:' + key);
    console.log('[verify] Activation result:', activation);

    const now = Date.now();

    if (activation === null) {
      console.log('[verify] First activation, setting timestamp:', now);
      await kv.set('activation:' + key, now);
      await kv.expire('activation:' + key, 60 * 60 * 24 * 30);
      console.log('[verify] Activation saved successfully');
      return res.status(200).json({ valid: true, firstUse: true });
    } else {
      const elapsed = now - activation;
      const hours = elapsed / (1000 * 60 * 60);
      console.log('[verify] Elapsed hours:', hours.toFixed(2));

      if (elapsed <= 24 * 60 * 60 * 1000) {
        console.log('[verify] Within 24h, valid');
        return res.status(200).json({ valid: true });
      } else {
        console.log('[verify] Expired');
        return res.status(200).json({ valid: false, reason: 'expired' });
      }
    }
  } catch (error) {
    console.error('[verify] Error:', error);
    console.error('[verify] Error message:', error.message);
    console.error('[verify] Error stack:', error.stack);
    return res.status(200).json({ valid: false, reason: 'kv_error', detail: error.message });
  }
};
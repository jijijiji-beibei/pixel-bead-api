const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawKey = (req.body && req.body.key) || '';
  const key = String(rawKey).trim().toUpperCase();
  const kvUrl = (process.env.KV_REST_API_URL || '').substring(0, 25);

  const debug = {
    rawKey: rawKey,
    trimmedKey: String(rawKey).trim(),
    normalizedKey: key,
    kvUrlPrefix: kvUrl + '...',
    kvUrlSet: !!process.env.KV_REST_API_URL,
    kvTokenSet: !!process.env.KV_REST_API_TOKEN,
    whitelistKey: 'valid:' + key,
    whitelistValue: null,
    whitelistFallbackKey: null,
    whitelistFallbackValue: null,
    activationKey: 'activation:' + key,
    activationValue: null,
  };

  if (!key) {
    return res.status(400).json({ valid: false, reason: 'missing_key', debug: debug });
  }

  try {
    console.log('[verify] kvUrl prefix:', kvUrl);
    console.log('[verify] normalized key:', key);

    // Step 1: Whitelist check (primary - uppercase)
    console.log('[verify] querying', debug.whitelistKey);
    let whitelisted = await kv.get(debug.whitelistKey);
    debug.whitelistValue = whitelisted;
    console.log('[verify] result:', whitelisted);

    // Step 1b: Fallback - try lowercase if uppercase returned null
    if (whitelisted === null) {
      const lowerKey = 'valid:' + key.toLowerCase();
      debug.whitelistFallbackKey = lowerKey;
      console.log('[verify] fallback querying', lowerKey);
      const fallback = await kv.get(lowerKey);
      debug.whitelistFallbackValue = fallback;
      console.log('[verify] fallback result:', fallback);
      if (fallback !== null) {
        whitelisted = fallback;
      }
    }

    if (whitelisted === null) {
      console.log('[verify] key not found in whitelist');
      return res.status(200).json({ valid: false, reason: 'invalid_key', debug: debug });
    }

    // Step 2: Activation check
    console.log('[verify] querying', debug.activationKey);
    const activation = await kv.get(debug.activationKey);
    debug.activationValue = activation;
    console.log('[verify] activation result:', activation);

    const now = Date.now();

    if (activation === null) {
      console.log('[verify] first activation, saving');
      await kv.set(debug.activationKey, now);
      await kv.expire(debug.activationKey, 60 * 60 * 24 * 30);
      console.log('[verify] activation saved');
      return res.status(200).json({ valid: true, firstUse: true, debug: debug });
    } else {
      const elapsed = now - activation;
      const hours = elapsed / (1000 * 60 * 60);
      console.log('[verify] elapsed hours:', hours.toFixed(2));
      if (elapsed <= 24 * 60 * 60 * 1000) {
        return res.status(200).json({ valid: true, debug: debug });
      } else {
        return res.status(200).json({ valid: false, reason: 'expired', debug: debug });
      }
    }
  } catch (error) {
    console.error('[verify] error:', error.message);
    debug.errorMessage = error.message;
    return res.status(200).json({ valid: false, reason: 'kv_error', detail: error.message, debug: debug });
  }
};
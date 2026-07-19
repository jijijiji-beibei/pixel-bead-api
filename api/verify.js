const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawKey = (req.body && req.body.key) || '';
  const key = String(rawKey).trim();
  const debug = {
    rawKey: rawKey,
    trimmedKey: key,
    kvUrlSet: !!process.env.KV_REST_API_URL,
    kvTokenSet: !!process.env.KV_REST_API_TOKEN,
    whitelistKey: 'valid:' + key,
    whitelistValue: null,
    activationKey: 'activation:' + key,
    activationValue: null,
  };

  if (!key) {
    return res.status(400).json({ valid: false, reason: 'missing_key', debug: debug });
  }

  try {
    // Step 1: Whitelist check
    const whitelisted = await kv.get(debug.whitelistKey);
    debug.whitelistValue = whitelisted;
    console.log('[verify] whitelist lookup:', debug.whitelistKey, '=', whitelisted);

    if (whitelisted === null) {
      return res.status(200).json({ valid: false, reason: 'invalid_key', debug: debug });
    }

    // Step 2: Activation check
    const activation = await kv.get(debug.activationKey);
    debug.activationValue = activation;
    console.log('[verify] activation lookup:', debug.activationKey, '=', activation);

    const now = Date.now();

    if (activation === null) {
      await kv.set(debug.activationKey, now);
      await kv.expire(debug.activationKey, 60 * 60 * 24 * 30);
      console.log('[verify] first activation saved');
      return res.status(200).json({ valid: true, firstUse: true, debug: debug });
    } else {
      const elapsed = now - activation;
      if (elapsed <= 24 * 60 * 60 * 1000) {
        return res.status(200).json({ valid: true, debug: debug });
      } else {
        return res.status(200).json({ valid: false, reason: 'expired', debug: debug });
      }
    }
  } catch (error) {
    console.error('[verify] Error:', error.message);
    debug.errorMessage = error.message;
    debug.errorStack = error.stack;
    return res.status(200).json({ valid: false, reason: 'kv_error', detail: error.message, debug: debug });
  }
};
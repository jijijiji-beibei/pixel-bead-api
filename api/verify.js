module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawKey = (req.body && req.body.key) || '';
  const key = String(rawKey).trim().toUpperCase();
  const kvUrl = process.env.KV_REST_API_URL || '';
  const kvToken = process.env.KV_REST_API_TOKEN || '';

  const debug = {
    rawKey: rawKey,
    normalizedKey: key,
    kvUrlPrefix: kvUrl.substring(0, 25) + '...',
    kvUrlSet: !!kvUrl,
    kvTokenSet: !!kvToken,
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

  if (!kvUrl || !kvToken) {
    debug.errorMessage = 'KV not configured';
    return res.status(200).json({ valid: false, reason: 'kv_error', detail: 'KV environment variables not set', debug: debug });
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
    // Step 1: Whitelist check
    let whitelisted = await kvGet(debug.whitelistKey);
    debug.whitelistValue = whitelisted;

    if (whitelisted === null) {
      // Fallback - try lowercase
      const lowerKey = 'valid:' + key.toLowerCase();
      debug.whitelistFallbackKey = lowerKey;
      const fallback = await kvGet(lowerKey);
      debug.whitelistFallbackValue = fallback;
      if (fallback !== null) whitelisted = fallback;
    }

    if (whitelisted === null) {
      return res.status(200).json({ valid: false, reason: 'invalid_key', debug: debug });
    }

    // Step 2: Activation check
    const activation = await kvGet(debug.activationKey);
    debug.activationValue = activation;
    const now = Date.now();

    if (activation === null) {
      await kvSet(debug.activationKey, now);
      await kvExpire(debug.activationKey, 60 * 60 * 24 * 30);
      return res.status(200).json({ valid: true, firstUse: true, debug: debug });
    } else {
      const elapsed = now - Number(activation);
      if (elapsed <= 24 * 60 * 60 * 1000) {
        return res.status(200).json({ valid: true, debug: debug });
      } else {
        return res.status(200).json({ valid: false, reason: 'expired', debug: debug });
      }
    }
  } catch (error) {
    debug.errorMessage = error.message;
    return res.status(200).json({ valid: false, reason: 'kv_error', detail: error.message, debug: debug });
  }
};
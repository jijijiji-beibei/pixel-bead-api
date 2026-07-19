module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawKey = (req.body && req.body.key) || '';
  const key = String(rawKey).trim().toUpperCase();

  // Use TEST_KV_URL if provided (for diagnostics), otherwise default env vars
  const kvUrl = (process.env.TEST_KV_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
  const kvToken = process.env.KV_REST_API_TOKEN || '';

  const debug = {
    rawKey: rawKey,
    normalizedKey: key,
    kvUrlFull: kvUrl || '(empty)',
    kvTokenPrefix: kvToken ? kvToken.substring(0, 10) + '...' : '(empty)',
    kvUrlSet: !!process.env.KV_REST_API_URL,
    kvTokenSet: !!process.env.KV_REST_API_TOKEN,
    testUrlSet: !!process.env.TEST_KV_URL,
    whitelistKey: 'valid:' + key,
    whitelistValue: null,
    whitelistFallbackKey: 'valid:' + key.toLowerCase(),
    whitelistFallbackValue: null,
    scannedKeys: null,
    matchedByScan: null,
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

  async function kvScanKeys(pattern) {
    // Use SCAN to find keys matching pattern (cursor=0, count=100)
    try {
      const r = await fetch(kvUrl + '/scan/0', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + kvToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ match: pattern, count: 100 }),
        signal: AbortSignal.timeout(5000)
      });
      const d = await r.json();
      return d.result || [];
    } catch (e) {
      return [];
    }
  }

  try {
    // Step 1: Whitelist check (uppercase)
    let whitelisted = await kvGet(debug.whitelistKey);
    debug.whitelistValue = whitelisted;

    // Step 1b: Fallback - lowercase
    if (whitelisted === null) {
      const fb = await kvGet(debug.whitelistFallbackKey);
      debug.whitelistFallbackValue = fb;
      if (fb !== null) whitelisted = fb;
    }

    // Step 1c: If still null, scan the database to see what keys exist
    if (whitelisted === null) {
      const allValidKeys = await kvScanKeys('valid:*');
      debug.scannedKeys = allValidKeys.slice(0, 10); // show first 10
      
      // Try to find a case-insensitive match among scanned keys
      if (allValidKeys.length > 0) {
        const inputUpper = 'valid:' + key.toUpperCase();
        const inputLower = 'valid:' + key.toLowerCase();
        for (const sk of allValidKeys) {
          const skUpper = sk.toUpperCase();
          if (skUpper === inputUpper || sk === inputLower) {
            debug.matchedByScan = sk;
            whitelisted = await kvGet(sk);
            break;
          }
        }
      }
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
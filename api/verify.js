module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawKey = (req.body && req.body.key) || '';
  const key = String(rawKey).trim().toUpperCase();

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

  // --- INIT MODE: Special key to initialize the database ---
  // The INIT_KEY env var (default "INIT_DB_PEBBLE") allows setting up valid keys
  const initKey = (process.env.INIT_KEY || 'INIT_DB_PEBBLE').toUpperCase();
  if (key === initKey) {
    const defaultKeys = [
      'PEBBLE001', 'PEBBLE002', 'PEBBLE003', 'PEBBLE004', 'PEBBLE005',
      'TEST123', 'DEMO001', 'PRO001', 'PRO002', 'PRO003'
    ];
    const results = [];
    for (const k of defaultKeys) {
      try {
        const r = await fetch(kvUrl + '/set/valid:' + k, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + kvToken, 'Content-Type': 'application/json' },
          body: JSON.stringify('1'),
          signal: AbortSignal.timeout(5000)
        });
        results.push({ key: k, status: r.status });
      } catch (e) {
        results.push({ key: k, error: e.message });
      }
    }
    return res.status(200).json({
      valid: true,
      firstUse: false,
      setup: true,
      initializedKeys: defaultKeys,
      results: results,
      debug: debug
    });
  }
  // --- END INIT MODE ---

  if (!key) {
    return res.status(400).json({ valid: false, reason: 'missing_key', debug: debug });
  }

  if (!kvUrl || !kvToken) {
    debug.errorMessage = 'KV not configured';
    return res.status(200).json({ valid: false, reason: 'kv_error', detail: 'KV environment variables not set', debug: debug });
  }

  // Helper: KV GET via Upstash REST API
  async function kvGet(k) {
    const r = await fetch(kvUrl + '/get/' + encodeURIComponent(k), {
      headers: { Authorization: 'Bearer ' + kvToken },
      signal: AbortSignal.timeout(5000)
    });
    const d = await r.json();
    return d.result === undefined ? null : d.result;
  }

  // Helper: KV SET via Upstash REST API
  async function kvSet(k, v) {
    await fetch(kvUrl + '/set/' + encodeURIComponent(k), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + kvToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(v),
      signal: AbortSignal.timeout(5000)
    });
  }

  // Helper: KV EXPIRE via Upstash REST API
  async function kvExpire(k, ttl) {
    await fetch(kvUrl + '/expire/' + encodeURIComponent(k) + '/' + ttl, {
      headers: { Authorization: 'Bearer ' + kvToken },
      signal: AbortSignal.timeout(5000)
    });
  }

  // Helper: KV SCAN via Upstash REST API
  async function kvScan(pattern) {
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
    // --- DEBUG: ECHO TEST ---
    // If key is ECHO_TEST, just return debug info without doing anything
    if (key === 'ECHO_TEST') {
      debug.echo = true;
      // Still try to scan to show what's in the database
      const allKeys = await kvScan('*');
      debug.allDbKeys = allKeys.slice(0, 20);
      return res.status(200).json({ valid: false, reason: 'echo', debug: debug });
    }

    // Step 1: Check valid:* keys in database via SCAN to show ALL valid keys
    const allValidKeys = await kvScan('valid:*');
    debug.scannedKeys = allValidKeys.slice(0, 20);

    // Step 2: Check whitelist (uppercase first, then lowercase)
    let whitelisted = await kvGet(debug.whitelistKey);
    debug.whitelistValue = whitelisted;

    if (whitelisted === null) {
      const fb = await kvGet(debug.whitelistFallbackKey);
      debug.whitelistFallbackValue = fb;
      if (fb !== null) whitelisted = fb;
    }

    // Step 3: If still null, try case-insensitive match against scanned keys
    if (whitelisted === null && allValidKeys.length > 0) {
      const inputUpper = 'VALID:' + key.toUpperCase();
      for (const sk of allValidKeys) {
        if (sk.toUpperCase() === inputUpper) {
          debug.matchedByScan = sk;
          whitelisted = await kvGet(sk);
          break;
        }
      }
    }

    if (whitelisted === null) {
      return res.status(200).json({ valid: false, reason: 'invalid_key', debug: debug });
    }

    // Step 4: Activation check
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
    debug.errorStack = error.stack;
    return res.status(200).json({ valid: false, reason: 'kv_error', detail: error.message, debug: debug });
  }
};

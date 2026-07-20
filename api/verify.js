module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
    activationKey: 'activation:' + key,
    activationValue: null,
    scannedKeys: null,
    matchedByScan: null,
  };

  // --- INIT MODE: Special key to initialize the database ---
  const initKey = (process.env.INIT_KEY || 'INIT_DB_PEBBLE').toUpperCase();
  if (key === initKey) {
    const defaultKeys = [
      'PEBBLE001', 'PEBBLE002', 'PEBBLE003', 'PEBBLE004', 'PEBBLE005',
      'TEST123', 'DEMO001', 'PRO001', 'PRO002', 'PRO003'
    ];
    const results = [];
    const now = Date.now();
    for (const k of defaultKeys) {
      try {
        // Set whitelist
        const r1 = await fetch(kvUrl + '/set/valid:' + k, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + kvToken, 'Content-Type': 'application/json' },
          body: JSON.stringify('1'),
          signal: AbortSignal.timeout(5000)
        });
        // Set activation timestamp (pre-activate for testing)
        await fetch(kvUrl + '/set/activation:' + k, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + kvToken, 'Content-Type': 'application/json' },
          body: JSON.stringify(now),
          signal: AbortSignal.timeout(5000)
        });
        // Set expire on activation (30 days)
        await fetch(kvUrl + '/expire/activation:' + k + '/' + (60*60*24*30), {
          headers: { Authorization: 'Bearer ' + kvToken },
          signal: AbortSignal.timeout(5000)
        });
        results.push({ key: k, status: r1.status });
      } catch (e) {
        results.push({ key: k, error: e.message });
      }
    }
    return res.status(200).json({
      valid: true,
      setup: true,
      initializedKeys: defaultKeys,
      results: results,
      debug: debug
    });
  }

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
    // Echo test - show debug info
    if (key === 'ECHO_TEST') {
      const allKeys = await kvScan('*');
      debug.allDbKeys = allKeys.slice(0, 20);
      return res.status(200).json({ valid: false, reason: 'echo', debug: debug });
    }

    // Step 1: Scan valid:* keys
    const allValidKeys = await kvScan('valid:*');
    debug.scannedKeys = allValidKeys.slice(0, 20);

    // Step 2: Check whitelist (uppercase first, then lowercase)
    let whitelisted = await kvGet(debug.whitelistKey);
    debug.whitelistValue = whitelisted;

    if (whitelisted === null) {
      const fb = await kvGet('valid:' + key.toLowerCase());
      debug.whitelistFallbackValue = fb;
      if (fb !== null) whitelisted = fb;
    }

    // Step 3: Case-insensitive scan match
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

    // Step 4: If not in whitelist → invalid
    if (whitelisted === null) {
      return res.status(200).json({ valid: false, reason: 'invalid_key', debug: debug });
    }

    // Step 5: Check activation (must be sold/activated by card system)
    const activation = await kvGet(debug.activationKey);
    debug.activationValue = activation;
    const now = Date.now();

    if (activation === null) {
      // Key is in whitelist but NOT yet sold/activated → tell user
      return res.status(200).json({
        valid: false,
        reason: 'not_activated',
        message: '该密钥尚未激活，请前往发卡站购买后使用',
        debug: debug
      });
    }

    // Step 6: Check 24h expiry from activation time
    const elapsed = now - Number(activation);
    if (elapsed <= 24 * 60 * 60 * 1000) {
      const hoursLeft = Math.floor((24 * 60 * 60 * 1000 - elapsed) / (1000 * 60 * 60));
      const minutesLeft = Math.floor(((24 * 60 * 60 * 1000 - elapsed) % (1000 * 60 * 60)) / (1000 * 60));
      return res.status(200).json({
        valid: true,
        expiresIn: 24 * 60 * 60 * 1000 - elapsed,
        message: '密钥有效，剩余 ' + hoursLeft + ' 小时 ' + minutesLeft + ' 分钟',
        debug: debug
      });
    } else {
      return res.status(200).json({ valid: false, reason: 'expired', debug: debug });
    }
  } catch (error) {
    debug.errorMessage = error.message;
    return res.status(200).json({ valid: false, reason: 'kv_error', detail: error.message, debug: debug });
  }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const pwd = (process.env.ADMIN_PASSWORD || 'admin888');
  if ((req.body && req.body.password) !== pwd) {
    return res.status(200).json({ success: false, error: 'auth_failed', message: '管理员密码错误' });
  }

  const count = Math.min(Math.max(parseInt(req.body.count) || 10, 1), 100);
  const prefix = (req.body.prefix || 'PEBBLE').toUpperCase();
  const kvUrl = (process.env.TEST_KV_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
  const kvToken = process.env.KV_REST_API_TOKEN || '';
  if (!kvUrl || !kvToken) {
    return res.status(200).json({ success: false, error: 'kv_error', message: 'KV not configured' });
  }

  async function setKey(k, v) {
    const r = await fetch(kvUrl + '/set/' + encodeURIComponent(k), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + kvToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(v), signal: AbortSignal.timeout(5000)
    });
    return r.status === 200;
  }

  function genKey(pre) {
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let k = pre;
    for (let i = 0; i < 8; i++) k += c[Math.floor(Math.random() * c.length)];
    return k;
  }

  const keys = [], errs = [];
  for (let i = 0; i < count; i++) {
    const k = genKey(prefix);
    try {
      if (await setKey('valid:' + k, '1')) keys.push(k);
      else errs.push({ key: k, error: 'KV write failed' });
    } catch (e) { errs.push({ key: k, error: e.message }); }
  }

  return res.status(200).json({
    success: errs.length === 0, total: count,
    successCount: keys.length, failCount: errs.length,
    keys: keys, importText: keys.join('\n'),
    message: '成功生成 ' + keys.length + ' 个密钥，失败 ' + errs.length + ' 个'
  });
};
const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { key } = req.body || {};
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Missing key' });
  }

  try {
    // 从 KV 读取该密钥的激活时间戳
    const activation = await kv.get('activation:' + key);
    const now = Date.now();

    if (activation === null) {
      // 首次激活：记录时间戳，设置 KV 过期时间 30 天（自动清理）
      await kv.set('activation:' + key, now);
      await kv.expire('activation:' + key, 60 * 60 * 24 * 30);
      return res.status(200).json({ valid: true, firstUse: true });
    } else {
      // 非首次：检查是否在 24 小时内
      const elapsed = now - activation;
      if (elapsed <= 24 * 60 * 60 * 1000) {
        return res.status(200).json({ valid: true });
      } else {
        return res.status(200).json({ valid: false, reason: 'expired' });
      }
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

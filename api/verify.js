export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ valid: false, reason: "method_not_allowed" });
  }

  const { key } = req.body || {};
  if (!key || typeof key !== "string") {
    return res.status(400).json({ valid: false, reason: "invalid" });
  }

  try {
    const record = await (await fetch(
      `${process.env.KV_REST_API_URL}/get/pixelbead_key_${key}`,
      { headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` } }
    )).json();

    if (!record || !record.result) {
      return res.status(200).json({ valid: false, reason: "invalid" });
    }

    return res.status(200).json({ valid: true });
  } catch (err) {
    console.error("Verify error:", err);
    return res.status(500).json({ valid: false, reason: "server_error" });
  }
}

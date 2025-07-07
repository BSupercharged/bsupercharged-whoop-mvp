export default async function handler(req, res) {
  console.log("🧪 CALLBACK QUERY:", req.query);

  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).json({ error: "Missing code or state" });
  }

  const phoneMatch = decodeURIComponent(state).match(/whatsapp=([^&]+)/);
  const whatsapp = phoneMatch ? phoneMatch[1] : null;

  if (!whatsapp) {
    return res.status(400).json({ error: "Missing WhatsApp number" });
  }

  try {
    const tokenRes = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
        redirect_uri: process.env.WHOOP_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("WHOOP token error", tokenData);
      return res.status(500).json({ error: "Token exchange failed", details: tokenData });
    }

    // 🚀 You can now store `tokenData.access_token` against `whatsapp`
    console.log("✅ WHOOP tokenData:", tokenData, "📱", whatsapp);

    res.status(200).json({ success: true, whatsapp, token: tokenData });
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).json({ error: "Internal error", details: err.message });
  }
}
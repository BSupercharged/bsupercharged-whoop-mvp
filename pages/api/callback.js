export default async function handler(req, res) {
  try {
    const { code, state } = req.query;

    console.log("🧪 CALLBACK QUERY:", req.query);

    if (!code || !state) {
      return res.status(400).json({ error: "Missing code or state" });
    }

    // 🧩 Handle possible '+' encoding (space issue)
    const stateDecoded = decodeURIComponent(state.replace(/\+/g, "%2B"));
    const params = new URLSearchParams(stateDecoded);
    const whatsapp = params.get("whatsapp");

    console.log("📲 Parsed WhatsApp:", whatsapp);

    if (!whatsapp) {
      return res.status(400).json({ error: "Missing WhatsApp number" });
    }

    // 🔐 WHOOP token exchange
    const tokenRes = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
        redirect_uri: process.env.WHOOP_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error("❌ WHOOP token error:", errorText);
      return res.status(500).json({ error: "WHOOP token exchange failed", details: errorText });
    }

    const tokenData = await tokenRes.json();
    console.log("✅ Token response:", tokenData);

    // TODO: Store tokens securely
    // await db.save({ whatsapp, ...tokenData });

    return res.status(200).json({ success: true, whatsapp, tokenData });
  } catch (error) {
    console.error("❌ Callback handler crash:", error);
    return res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
}

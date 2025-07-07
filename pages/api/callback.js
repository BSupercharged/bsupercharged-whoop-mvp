import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const code = req.query.code;
  const state = req.query.state;

  // Debug log: what is state on entry?
  console.log("[DEBUG] Received state:", state);
  console.log("[DEBUG] Received code:", code);

  // Robustly extract WhatsApp number regardless of encoding
  let whatsapp = "";
  if (typeof state === "string" && state.startsWith("whatsapp=")) {
    const rawValue = state.split("=")[1];
    whatsapp = decodeURIComponent(rawValue);
  }

  // Debug log: what is parsed whatsapp?
  console.log("[DEBUG] Parsed WhatsApp:", whatsapp);

  if (!code || !whatsapp) {
    console.error("[ERROR] Missing code or invalid WhatsApp number", { code, state, whatsapp });
    return res.status(400).json({ error: "Missing code or invalid WhatsApp number", debug: { code, state, whatsapp } });
  }

  const client_id = process.env.WHOOP_CLIENT_ID;
  const client_secret = process.env.WHOOP_CLIENT_SECRET;
  const redirect_uri = process.env.WHOOP_REDIRECT_URI;

  try {
    // Exchange code for token
    const tokenRes = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id,
        client_secret,
        redirect_uri
      }).toString()
    });

    // Debug log: token exchange response
    const tokenText = await tokenRes.text();
    console.log("[DEBUG] Raw token response:", tokenText);

    let tokenData;
    try {
      tokenData = JSON.parse(tokenText);
    } catch (err) {
      console.error("[ERROR] Could not parse token response", tokenText);
      return res.status(500).json({ error: "Failed to parse token response", raw: tokenText });
    }

    if (!tokenData.access_token) {
      console.error("[ERROR] Token exchange failed", tokenData);
      return res.status(500).json({ error: "Token exchange failed", debug: tokenData });
    }

    // Store in MongoDB
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    const updateResult = await collection.updateOne(
      { whatsapp },
      {
        $set: {
          whatsapp,
          ...tokenData,
          created_at: new Date(),
          expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000)
        }
      },
      { upsert: true }
    );

    // Debug log: Mongo result
    console.log("[DEBUG] Mongo update result:", updateResult);

    await mongoClient.close();

    // Debug log: final redirect
    const redirectUrl = `/login-redirect-success?whatsapp=${encodeURIComponent(whatsapp)}`;
    console.log("[DEBUG] Redirecting to:", redirectUrl);

    res.redirect(redirectUrl);
  } catch (err) {
    console.error("[ERROR] OAuth callback failed:", err);
    return res.status(500).json({ error: "OAuth callback failed", debug: err.message });
  }
}

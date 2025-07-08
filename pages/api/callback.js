import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const { code, state } = req.query;

  // Add debug info
  console.log("[DEBUG] Query received by /api/callback:", req.query);

  // Attempt to parse whatsapp from state
  let whatsapp = null;
  try {
    // If state is like "phone=123456789", use URLSearchParams
    const params = new URLSearchParams(state);
    whatsapp = params.get("phone") || params.get("whatsapp");
  } catch (err) {
    console.log("[DEBUG] Failed to parse state param:", err, "Raw state:", state);
  }

  if (!code) {
    return res.status(400).json({ error: "Missing code in callback", debug: req.query });
  }

  if (!whatsapp) {
    // Return everything we got for debugging
    return res.status(400).json({ error: "Missing WhatsApp number after OAuth", debug: { state, query: req.query } });
  }

  const client_id = process.env.WHOOP_CLIENT_ID;
  const client_secret = process.env.WHOOP_CLIENT_SECRET;
  const redirect_uri = process.env.WHOOP_REDIRECT_URI;

  try {
    // Exchange code for access token
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

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(500).json({ error: "Token exchange failed", debug: tokenData });
    }

    // Store in MongoDB
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    await collection.updateOne(
      { whatsapp },
      {
        $set: {
          whatsapp,
          ...tokenData,
          created_at: new Date(),
          expires_at: new Date(Date.now() + tokenData.expires_in * 1000)
        }
      },
      { upsert: true }
    );

    await mongoClient.close();

    // Redirect back to WhatsApp chat
    res.redirect("https://wa.me/" + encodeURIComponent(whatsapp));
  } catch (err) {
    console.error("OAuth callback failed:", err);
    res.status(500).json({ error: "OAuth callback failed", debug: err.message });
  }
}

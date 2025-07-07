import { MongoClient } from "mongodb";
import fetch from "node-fetch";

export default async function handler(req, res) {
  const { code, state: whatsapp } = req.query;

  if (!code || !whatsapp) {
    return res.status(400).json({ error: "Missing code or WhatsApp number" });
  }

  try {
    const tokenRes = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
        redirect_uri: process.env.WHOOP_REDIRECT_URI
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return res.status(401).json({ error: "Failed to retrieve token", raw: tokenData });
    }

    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    // Overwrite any existing entry for this user
    await collection.updateOne(
      { whatsapp },
      { $set: { ...tokenData, whatsapp, updated_at: new Date() } },
      { upsert: true }
    );

    await mongoClient.close();

    res.status(200).send("✅ WHOOP login successful. You can return to WhatsApp and ask about your recovery.");
  } catch (err) {
    res.status(500).json({ error: "OAuth callback error", debug: err.message });
  }
}

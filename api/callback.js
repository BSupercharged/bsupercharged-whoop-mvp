import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const code = req.query.code;
  const whatsapp = req.query.state; // WhatsApp number passed as state param

  if (!code || !whatsapp) {
    return res.status(400).json({ success: false, error: "Missing code or WhatsApp number" });
  }

  const client_id = process.env.WHOOP_CLIENT_ID;
  const client_secret = process.env.WHOOP_CLIENT_SECRET;
  const redirect_uri = process.env.WHOOP_REDIRECT_URI;

  try {
    const response = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
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

    const tokenData = await response.json();
    if (!tokenData.access_token) {
      throw new Error("Failed to retrieve access token");
    }

    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    // Upsert token with whatsapp number
    await collection.updateOne(
      { whatsapp },
      { $set: { ...tokenData, whatsapp } },
      { upsert: true }
    );

    await mongoClient.close();
    res.status(200).json({ success: true, tokenData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

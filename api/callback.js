import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const code = req.query.code;
  const state = req.query.state;

  // Parse last 9 digits from state
  let phone = "";
  if (typeof state === "string" && state.startsWith("phone=")) {
    phone = state.split("=")[1];
  }

  if (!code || !phone) {
    return res.status(400).json({ error: "Missing code or phone", debug: { code, state, phone } });
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
      { phone },
      {
        $set: {
          phone,
          ...tokenData,
          created_at: new Date(),
          expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000)
        }
      },
      { upsert: true }
    );

    await mongoClient.close();

    // Redirect to custom success page (optional)
    res.redirect(`/login-redirect-success?phone=${phone}`);
  } catch (err) {
    console.error("OAuth callback failed:", err);
    return res.status(500).json({ error: "OAuth callback failed", debug: err.message });
  }
}

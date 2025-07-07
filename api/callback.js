// /api/callback.js

import { MongoClient } from "mongodb";

export default async function handler(req, res) {
  try {
    const code = req.query.code;
    if (!code) {
      return res.status(400).json({ success: false, error: "Missing code in request" });
    }

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("client_id", process.env.WHOOP_CLIENT_ID);
    params.append("client_secret", process.env.WHOOP_CLIENT_SECRET);
    params.append("redirect_uri", process.env.WHOOP_REDIRECT_URI);

    const tokenRes = await fetch("https://api.whoop.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      return res.status(500).json({
        success: false,
        error: "Failed to exchange code for token",
        details: tokenData
      });
    }

    // Store in MongoDB
    const client = await MongoClient.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    const db = client.db("whoop_mvp");
    const collection = db.collection("whoop_mvp");

    await collection.insertOne({
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
      token_type: tokenData.token_type,
      created_at: new Date()
    });

    await client.close();

    res.status(200).json({ success: true, data: tokenData });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Something went wrong",
      debug: error.message || error.toString()
    });
  }
}

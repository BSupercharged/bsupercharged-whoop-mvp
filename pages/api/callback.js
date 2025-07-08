// /pages/api/callback.js

import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const code = req.query.code;
  const user = req.query.state; // The phone number as string

  // Debug logs
  console.log('[CALLBACK] code:', code);
  console.log('[CALLBACK] user (from state):', user);

  if (!code || !user) {
    return res.status(400).json({
      error: "Missing code or user (phone) number",
      debug: { code, user, state: req.query.state }
    });
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
    console.log('[CALLBACK] tokenData:', tokenData);

    if (!tokenData.access_token) {
      return res.status(500).json({ error: "Token exchange failed", debug: tokenData });
    }

    // Store in MongoDB
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    await collection.updateOne(
      { user },
      {
        $set: {
          user,
          ...tokenData,
          created_at: new Date(),
          expires_at: new Date(Date.now() + tokenData.expires_in * 1000)
        }
      },
      { upsert: true }
    );

    await mongoClient.close();

    // Redirect back to WhatsApp chat or thank you page
    res.redirect("https://wa.me/" + encodeURIComponent(user));
  } catch (err) {
    console.error("OAuth callback failed:", err);
    res.status(500).json({ error: "OAuth callback failed", debug: err.message });
  }
}

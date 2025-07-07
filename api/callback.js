
/**
 * File: /api/callback.js
 * Purpose: Handles OAuth callback and stores WHOOP token with WhatsApp number
 */

import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const code = req.query.code;
  const state = req.query.state;

  const whatsapp = new URLSearchParams(state).get("whatsapp");
  if (!code || !whatsapp) {
    return res.status(400).json({ error: "Missing code or invalid WhatsApp number" });
  }

  const client_id = process.env.WHOOP_CLIENT_ID;
  const client_secret = process.env.WHOOP_CLIENT_SECRET;
  const redirect_uri = process.env.WHOOP_REDIRECT_URI;

  try {
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

    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    await collection.insertOne({
      whatsapp,
      ...tokenData,
      created_at: new Date()
    });

    await mongoClient.close();
    res.redirect("https://wa.me/" + encodeURIComponent(whatsapp));
  } catch (err) {
    res.status(500).json({ error: "OAuth callback failed", debug: err.message });
  }
}

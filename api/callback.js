import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).json({ success: false, error: "Missing code in request" });
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

    const text = await response.text();
    let tokenData;

    try {
      tokenData = JSON.parse(text);
    } catch (jsonErr) {
      throw new Error(`Failed to parse response: ${text}`);
    }

    if (!tokenData.access_token) {
      return res.status(500).json({
        success: false,
        error: "WHOOP did not return an access token",
        debug: tokenData
      });
    }

    // Add expiry timestamp for easier token management
    tokenData.expires_at = Date.now() + (tokenData.expires_in * 1000);

    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    // Associate token with user if phone available (multi-user support ready)
    if (req.query.phone) {
      tokenData.phone = req.query.phone;
    }

    const result = await collection.insertOne(tokenData);
    await mongoClient.close();

    res.status(200).json({
      success: true,
      tokenData,
      mongo_id: result.insertedId
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Something went wrong during WHOOP token exchange",
      debug: err.message
    });
  }
}

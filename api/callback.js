import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: "Missing code in request",
    });
  }

  const client_id = process.env.WHOOP_CLIENT_ID;
  const client_secret = process.env.WHOOP_CLIENT_SECRET;
  const redirect_uri = process.env.WHOOP_REDIRECT_URI;
  const mongo_uri = process.env.MONGODB_URI;

  try {
    const response = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id,
        client_secret,
        redirect_uri,
      }).toString(),
    });

    const text = await response.text();

    // Log raw response if status is not ok
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `Token request failed`,
        status: response.status,
        body: text,
      });
    }

    let tokenData;
    try {
      tokenData = JSON.parse(text);
    } catch (parseError) {
      return res.status(500).json({
        success: false,
        error: "Failed to parse token response",
        raw: text,
      });
    }

    const mongoClient = new MongoClient(mongo_uri);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    const result = await collection.insertOne(tokenData);
    await mongoClient.close();

    res.status(200).json({
      success: true,
      tokenData,
      mongo_id: result.insertedId,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Something went wrong",
      debug: err.message,
      stack: err.stack,
      env: {
    client_id,
    redirect_uri,
    hasSecret: !!client_secret
    });
  }
}

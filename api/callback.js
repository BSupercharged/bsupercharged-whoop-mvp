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

  let debugInfo = {
    receivedCode: code,
    client_id,
    client_secret: client_secret ? "[REDACTED - PRESENT]" : "[MISSING]",
    redirect_uri,
    mongo_uri: mongo_uri ? "[REDACTED - PRESENT]" : "[MISSING]",
  };

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

    debugInfo.status = response.status;
    debugInfo.ok = response.ok;
    debugInfo.headers = Object.fromEntries(response.headers.entries());
    const text = await response.text();
    debugInfo.rawResponse = text;

    let tokenData = {};
    try {
      tokenData = JSON.parse(text);
    } catch (parseErr) {
      debugInfo.parseError = parseErr.message;
    }

    const mongoClient = new MongoClient(mongo_uri);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    const result = await collection.insertOne(tokenData);
    await mongoClient.close();

    return res.status(200).json({
      success: true,
      tokenData,
      mongo_id: result.insertedId,
      debug: debugInfo,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Exception thrown",
      debug: {
        ...debugInfo,
        err: err.message,
        stack: err.stack,
      },
    });
  }
}

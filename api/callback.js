
import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const code = req.query.code;
    if (!code) {
      return res.status(400).json({ success: false, error: "Missing code in request" });
    }

    const client_id = process.env.WHOOP_CLIENT_ID;
    const client_secret = process.env.WHOOP_CLIENT_SECRET;
    const redirect_uri = process.env.WHOOP_REDIRECT_URI;

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

    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db("whoop_mvp");
    const collection = db.collection("whoop_mvp");

    const result = await collection.insertOne(tokenData);
    await client.close();

    res.status(200).json({ success: true, data: tokenData, mongo_id: result.insertedId });
  } catch (err) {
    res.status(500).json({ success: false, error: "Something went wrong", debug: err.message });
  }
}

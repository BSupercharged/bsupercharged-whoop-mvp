import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    const latestToken = await collection.findOne({}, { sort: { _id: -1 } });

    if (!latestToken?.access_token) {
      await mongoClient.close();
      return res.status(401).json({ success: false, error: "No access token found" });
    }

    const response = await fetch("https://api.prod.whoop.com/oauth/user/profile", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${latestToken.access_token}`,
        Accept: "application/json"
      }
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Non-JSON response from WHOOP",
        raw: text
      });
    }

    await mongoClient.close();
    res.status(200).json({ success: true, profile: data, debug: { status: response.status, headers: Object.fromEntries(response.headers.entries()) } });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Fetch failed",
      debug: err.message
    });
  }
}

import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  let mongoClient;
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    const latestToken = await collection.findOne({}, { sort: { _id: -1 } });
    if (!latestToken?.access_token) {
      return res.status(401).json({ success: false, error: "No access token found" });
    }

    const accessToken = latestToken.access_token;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    };

    const endpoints = {
      profile: "https://api.prod.whoop.com/developer/v1/user/profile/basic",
      recovery: "https://api.prod.whoop.com/developer/v1/recovery",
      sleep: "https://api.prod.whoop.com/developer/v1/sleep",
      workout: "https://api.prod.whoop.com/developer/v1/activity",
      body: "https://api.prod.whoop.com/developer/v1/body"
    };

    const results = {};
    for (const [key, url] of Object.entries(endpoints)) {
      const r = await fetch(url, { headers });
      const txt = await r.text();

      try {
        results[key] = JSON.parse(txt);
      } catch {
        results[key] = { error: "Non-JSON response", raw: txt };
      }
    }

    return res.status(200).json({ success: true, ...results });

  } catch (err) {
    return res.status(500).json({ success: false, error: "Unexpected error", debug: err.message });
  } finally {
    if (mongoClient) await mongoClient.close();
  }
}


import { MongoClient } from 'mongodb';

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

    await mongoClient.close();
    res.status(200).json({ success: true, ...results });

  } catch (err) {
    res.status(500).json({ success: false, error: "Unexpected error", debug: err.message });
  }
}


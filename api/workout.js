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

    const response = await fetch("https://api.prod.whoop.com/developer/v1/activity", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${latestToken.access_token}`,
        Accept: "application/json"
      }
    });

    const data = await response.json();
    await mongoClient.close();
    res.status(200).json({ success: true, activity: data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Fetch failed", debug: err.message });
  }
}
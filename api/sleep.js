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

    const response = await fetch("https://api.prod.whoop.com/developer/v1/sleep", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${latestToken.access_token}`,
        Accept: "application/json"
      }
    });

    const data = await response.json();
    return res.status(200).json({ success: true, sleep: data });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Fetch failed", debug: err.message });
  } finally {
    if (mongoClient) await mongoClient.close();
  }
}
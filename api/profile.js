import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    // Fetch the most recent token (last inserted)
    const latestToken = await collection.findOne({}, { sort: { _id: -1 } });

    if (!latestToken || !latestToken.access_token) {
      await mongoClient.close();
      return res.status(401).json({ success: false, error: "No valid access token found" });
    }

    const response = await fetch("https://api.prod.whoop.com/users/profile", {
      headers: {
        Authorization: `Bearer ${latestToken.access_token}`
      }
    });

    const data = await response.json();
    await mongoClient.close();

    res.status(200).json({ success: true, profile: data });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch WHOOP profile",
      debug: err.message
    });
  }
}


import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db("whoop_mvp");
    const collection = db.collection("whoop_mvp");

    const latestUser = await collection.findOne({}, { sort: { _id: -1 } });
    const token = latestUser?.access_token || latestUser?.data?.access_token;

    if (!token) {
      return res.status(400).json({ success: false, error: "No access token found", user: latestUser });
    }

    const whoopRes = await fetch("https://api.prod.whoop.com/users/profile", {
      headers: { Authorization: `Bearer ${token}` }
    });

    const whoopData = await whoopRes.json();
    await client.close();

    res.status(200).json({ success: true, profile: whoopData });
  } catch (err) {
    res.status(500).json({ success: false, error: "Something went wrong", debug: err.message });
  }
}

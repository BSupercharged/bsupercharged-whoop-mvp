// pages/api/summary.js

import { MongoClient, ObjectId } from "mongodb";
import axios from "axios";

export default async function handler(req, res) {
  const mongoUri = process.env.MONGODB_URI;
  const client = new MongoClient(mongoUri);
  const dbName = "whoop_mvp";

  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection("whoop_mvp");

    // Get the most recent user (you can change this to a specific user later)
    const latestUser = await collection.findOne({}, { sort: { _id: -1 } });

    if (!latestUser || !latestUser.access_token) {
      return res.status(400).json({ success: false, error: "No access token found" });
    }

    const token = latestUser.access_token;

    // Fetch WHOOP profile (for user_id)
    const profileRes = await axios.get("https://api.prod.whoop.com/users/profile", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const userId = profileRes.data.user_id;

    // Fetch today's recovery
    const today = new Date().toISOString().split("T")[0];
    const recoveryRes = await axios.get(`https://api.prod.whoop.com/recovery`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        start: today,
        end: today
      }
    });

    // Fetch today's sleep
    const sleepRes = await axios.get(`https://api.prod.whoop.com/sleep`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        start: today,
        end: today
      }
    });

    // Fetch today's strain
    const strainRes = await axios.get(`https://api.prod.whoop.com/strain`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        start: today,
        end: today
      }
    });

    const summary = {
      userId,
      recovery: recoveryRes.data.records?.[0] || null,
      sleep: sleepRes.data.records?.[0] || null,
      strain: strainRes.data.records?.[0] || null
    };

    res.status(200).json({ success: true, data: summary });
  } catch (err) {
    console.error("Error in summary:", err);
    res.status(500).json({ success: false, error: "Failed to fetch summary", debug: err.message });
  } finally {
    await client.close();
  }
}

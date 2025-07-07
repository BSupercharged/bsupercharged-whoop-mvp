import axios from 'axios';
import { MongoClient } from 'mongodb';

export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).json({ success: false, error: 'Missing code in request' });
  }

  try {
    // 1. Exchange code for access token
    const tokenResponse = await axios.post(
      'https://api.prod.whoop.com/oauth/oauth2/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
        redirect_uri: process.env.WHOOP_REDIRECT_URI,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const tokenData = tokenResponse.data;

    // 2. Connect to MongoDB
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();

    const db = client.db('whoop_mvp');
    const collection = db.collection('whoop_mvp');

    // 3. Store the token response
    const result = await collection.insertOne({
      createdAt: new Date(),
      tokenData,
    });

    await client.close();

    return res.status(200).json({ success: true, data: tokenData, mongo_id: result.insertedId });
  } catch (error) {
    console.error('OAuth or DB Error:', error?.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: 'Something went wrong',
      debug: error?.response?.data || error.message,
    });
  }
}

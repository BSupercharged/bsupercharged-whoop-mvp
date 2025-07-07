// pages/api/callback.js

import { MongoClient } from 'mongodb';

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state' });
  }

  // ✅ Decode and extract WhatsApp number
  const decodedState = decodeURIComponent(state); // e.g. "whatsapp=+31610451196"
  const whatsapp = decodedState.replace(/^whatsapp=/, '');

  if (!whatsapp) {
    return res.status(400).json({ error: 'Missing WhatsApp number in state' });
  }

  try {
    // ✅ Step 1: Exchange code for access token
    const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
        code,
        redirect_uri: process.env.WHOOP_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('❌ Token exchange failed:', tokenData);
      return res.status(500).json({ error: 'Failed to exchange code for token', details: tokenData });
    }

    // ✅ Step 2: Save to MongoDB
    const mongoClient = await MongoClient.connect(process.env.MONGODB_URI);
    const db = mongoClient.db('whoop');
    const users = db.collection('users');

    await users.updateOne(
      { whatsapp },
      {
        $set: {
          whatsapp,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          token_type: tokenData.token_type,
          scope: tokenData.scope,
          updated_at: new Date(),
        },
      },
      { upsert: true }
    );

    await mongoClient.close();

    console.log(`✅ Stored WHOOP token for ${whatsapp}`);

    // ✅ Final response to user
    res.status(200).send('✅ WHOOP account successfully connected. You can now return to WhatsApp!');
  } catch (err) {
    console.error('❌ Callback error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

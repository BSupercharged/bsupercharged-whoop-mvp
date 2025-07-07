// pages/api/callback.js

import { MongoClient } from 'mongodb';

export default async function handler(req, res) {
  const { code, state } = req.query;

  console.log('🔁 WHOOP Callback query:', req.query);

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state' });
  }

  try {
    // ✅ Robust decoding of state (e.g., "whatsapp=%2B31610451196")
    const parsedState = Object.fromEntries(new URLSearchParams(decodeURIComponent(state)));
    const whatsapp = parsedState.whatsapp;

    console.log('📲 Extracted WhatsApp from state:', whatsapp);

    if (!whatsapp) {
      return res.status(400).json({ error: 'Missing WhatsApp number in state' });
    }

    // ✅ Exchange the code for an access token
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

    // ✅ Store tokens in MongoDB by WhatsApp number
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

    return res.status(200).send('✅ WHOOP connected. You can now return to WhatsApp.');
  } catch (err) {
    console.error('❌ Callback error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

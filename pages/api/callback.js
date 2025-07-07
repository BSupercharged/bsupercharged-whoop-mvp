import { MongoClient } from 'mongodb';

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state' });
  }

  try {
    // Step 1: Exchange code for token
    const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
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
      console.error('Token exchange error:', tokenData);
      return res.status(500).json({ error: 'Token exchange failed', details: tokenData });
    }

    // Step 2: Store token using WhatsApp number
    const whatsapp = state.replace(/^whatsapp=/, '');
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
          scope: tokenData.scope,
          token_type: tokenData.token_type,
          updated_at: new Date(),
        },
      },
      { upsert: true }
    );

    mongoClient.close();

    return res.status(200).send('✅ WHOOP connected! You can now return to WhatsApp.');
  } catch (err) {
    console.error('Callback error:', err);
    return res.status(500).json({ error: 'Callback failed', details: err.message });
  }
}

import { MongoClient } from 'mongodb';

export default async function handler(req, res) {
  const { code, state } = req.query;

  console.log('🟡 WHOOP callback received:', req.query);

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state' });
  }

  try {
    // ✅ Don't decode — state is already decoded
    const stateParams = new URLSearchParams(state);
    const whatsapp = stateParams.get('whatsapp');

    console.log('📲 WhatsApp in state:', whatsapp);

    if (!whatsapp) {
      return res.status(400).json({ error: 'Missing WhatsApp number in state' });
    }

    // ✅ Exchange WHOOP code for token
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
      return res.status(500).json({ error: 'Token exchange failed', details: tokenData });
    }

    // ✅ Save token to MongoDB
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

    console.log(`✅ WHOOP token stored for ${whatsapp}`);

    return res.status(200).send('✅ WHOOP account connected. You can now return to WhatsApp!');
  } catch (err) {
    console.error('❌ Callback error:', err);
    return res.status(500).json({ error: 'Callback failure', details: err.message });
  }
}

// pages/api/callback.js
import { storeTokenForUser } from '../../lib/db';

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state' });
  }

  // Extract phone number from state
  const match = state.match(/whatsapp=([^&]+)/);
  const phone = match ? decodeURIComponent(match[1]) : null;

  if (!phone) {
    return res.status(400).json({ error: 'Missing WhatsApp number' });
  }

  try {
    // Exchange code for token with WHOOP
    const response = await fetch('https://api.prod.whoop.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(
            `${process.env.WHOOP_CLIENT_ID}:${process.env.WHOOP_CLIENT_SECRET}`
          ).toString('base64'),
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.WHOOP_REDIRECT_URI,
      }),
    });

    const tokenData = await response.json();

    if (!response.ok) {
      console.error('WHOOP token error:', tokenData);
      return res.status(500).json({ error: 'Token exchange failed' });
    }

    // Store tokens with phone number
    await storeTokenForUser(phone, tokenData);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Callback error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

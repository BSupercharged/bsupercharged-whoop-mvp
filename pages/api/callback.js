import { storeTokenForUser } from '../../lib/db';

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state' });
  }

  // Extract phone number from state (format: "whatsapp=+316xxxxxxx")
  const params = new URLSearchParams(state);
  const whatsapp = params.get('whatsapp');
  const phoneOnly = whatsapp && whatsapp.startsWith('+') ? whatsapp.slice(1) : whatsapp;

  if (!whatsapp) {
    return res.status(400).json({ error: 'Missing WhatsApp number' });
  }

  try {
    // Exchange code for access token from WHOOP
    const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${process.env.WHOOP_CLIENT_ID}:${process.env.WHOOP_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/callback`,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      return res.status(400).json({ error: 'Token exchange failed', details: tokenData });
    }

    // Save token for this user
    await storeTokenForUser(whatsapp, tokenData);

    // Redirect back to WhatsApp chat
    res.redirect(`https://wa.me/${phoneOnly}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Callback handler error' });
  }
}

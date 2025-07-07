// pages/api/login.js

export default async function handler(req, res) {
  // 1. Extract the WhatsApp number from query string
  const { whatsapp } = req.query;

  console.log('📥 Incoming login request with:', req.query);

  // 2. Validate that we received the WhatsApp number
  if (!whatsapp) {
    return res.status(400).json({ error: "Missing WhatsApp number in query string" });
  }

  // 3. Construct the WHOOP OAuth2 URL
  const clientId = process.env.WHOOP_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.WHOOP_REDIRECT_URI);

  const scope = [
    'read:profile',
    'read:recovery',
    'read:sleep',
    'read:workout',
    'read:body_measurement'
  ].join(' ');

  const state = `whatsapp=${encodeURIComponent(whatsapp)}`;

  const authUrl =
    `https://api.prod.whoop.com/oauth/oauth2/auth` +
    `?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${state}`;

  // 4. Redirect user to WHOOP OAuth login
  return res.redirect(authUrl);
}

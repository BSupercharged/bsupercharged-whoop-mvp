// /api/login.js
export default async function handler(req, res) {
  const { whatsapp } = req.query;

  if (!whatsapp) {
    return res.status(400).json({ error: "Missing WhatsApp number" });
  }

  const state = `whatsapp=${encodeURIComponent(whatsapp)}`;
  const redirectUri = encodeURIComponent(process.env.WHOOP_REDIRECT_URI);
  const clientId = process.env.WHOOP_CLIENT_ID;

  const authUrl =
    `https://api.prod.whoop.com/oauth/oauth2/auth` +
    `?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=read:profile read:recovery read:sleep read:workout read:body_measurement` +
    `&state=${state}`;

  // 🔁 THIS is the fix — redirect instead of return JSON:
  res.redirect(authUrl);
}



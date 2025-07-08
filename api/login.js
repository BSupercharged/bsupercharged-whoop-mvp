// /api/login.js
export default async function handler(req, res) {
  const { user } = req.query;
  if (!user) {
    return res.status(400).json({ error: "Missing user (phone) number", debug: { query: req.query } });
  }

  const phone = user.replace(/[^\d]/g, '').slice(-9) || "000000000";
  const state = `user=${phone}`;
  const redirectUri = encodeURIComponent(process.env.WHOOP_REDIRECT_URI);
  const clientId = process.env.WHOOP_CLIENT_ID;

  const authUrl =
    `https://api.prod.whoop.com/oauth/oauth2/auth` +
    `?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=read:profile read:recovery read:sleep read:workout read:body_measurement` +
    `&state=${state}`;

  res.redirect(authUrl);
}


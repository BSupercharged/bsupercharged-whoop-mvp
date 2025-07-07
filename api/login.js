// /api/login.js
export default async function handler(req, res) {
  const { whatsapp } = req.query;
  const state = encodeURIComponent(whatsapp || "anon" + Math.random().toString(36).slice(2, 10));

  const whoopOAuthUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?client_id=${process.env.WHOOP_CLIENT_ID}` +
    `&response_type=code&scope=read:profile read:recovery read:sleep read:workout read:body_measurement` +
    `&redirect_uri=${encodeURIComponent(process.env.WHOOP_REDIRECT_URI)}` +
    `&state=${state}`;

  res.redirect(whoopOAuthUrl);
}

// pages/api/login.js
export default function handler(req, res) {
  const redirectUri = encodeURIComponent("https://bsupercharged-whoop-mvp.vercel.app/api/callback");
  const state = encodeURIComponent(`whatsapp=${req.query.phone || ''}`);
  const clientId = process.env.WHOOP_CLIENT_ID;

  const authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=read:profile read:recovery read:sleep read:workout read:body_measurement&state=${state}`;

  res.redirect(authUrl);
}

// /api/login.js
export default async function handler(req, res) {
  const { whatsapp } = req.query;

  if (!whatsapp) {
    return res.status(400).json({ error: "Missing WhatsApp number" });
  }

  const state = encodeURIComponent(`whatsapp=${whatsapp}`);

  const url =
    `https://api.prod.whoop.com/oauth/oauth2/auth` +
    `?response_type=code` +
    `&client_id=${process.env.WHOOP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.WHOOP_REDIRECT_URI)}` +
    `&scope=read:profile read:recovery read:sleep read:workout read:body_measurement` +
    `&state=${state}`;

  // 🚨 Make sure to use redirect!
  return res.redirect(url);
}


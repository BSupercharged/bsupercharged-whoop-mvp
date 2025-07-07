export default function handler(req, res) {
  const { whatsapp } = req.query;

  if (!whatsapp || whatsapp.length < 8) {
    return res.status(400).json({ error: "Missing or invalid WhatsApp number" });
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.WHOOP_CLIENT_ID,
    redirect_uri: process.env.WHOOP_REDIRECT_URI,
    scope: "read:profile read:recovery read:sleep read:workout read:body_measurement",
    state: whatsapp // this links the token back to the user's WhatsApp
  });

  const url = `https://join.whoop.com/oauth/oauth2/auth?${params.toString()}`;
  res.status(200).json({ url });
}

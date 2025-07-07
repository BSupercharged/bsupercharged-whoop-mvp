export default function handler(req, res) {
  const client_id = process.env.WHOOP_CLIENT_ID;
  const redirect_uri = process.env.WHOOP_REDIRECT_URI;
  const scope = "read:profile read:recovery read:sleep read:workout read:body_measurement";
  const state = "bscWhoop1"; // must be at least 8 characters

  if (!client_id || !redirect_uri) {
    return res.status(500).json({
      error: "Missing WHOOP_CLIENT_ID or WHOOP_REDIRECT_URI in env"
    });
  }

  const authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?client_id=${client_id}&redirect_uri=${encodeURIComponent(
    redirect_uri
  )}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`;

  res.status(200).json({ success: true, url: authUrl });
}

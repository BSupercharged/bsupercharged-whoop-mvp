// /api/callback.js

export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).json({ success: false, error: "Missing code" });
  }

  const client_id = process.env.WHOOP_CLIENT_ID;
  const client_secret = process.env.WHOOP_CLIENT_SECRET;
  const redirect_uri = process.env.WHOOP_REDIRECT_URI;

  const tokenUrl = "https://api.prod.whoop.com/oauth/oauth2/token";

  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id,
        client_secret,
        grant_type: "authorization_code",
        redirect_uri,
      }).toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ success: false, data });
    }

    return res.status(200).json({ success: true, tokens: data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

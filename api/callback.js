import axios from "axios";

export default async function handler(req, res) {
  const { code } = req.query;
  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.WHOOP_REDIRECT_URI,
    client_id: process.env.WHOOP_CLIENT_ID,
    client_secret: process.env.WHOOP_CLIENT_SECRET
  });

  try {
    const response = await axios.post("https://api.prod.whoop.com/oauth/oauth2/token", payload.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    res.status(200).json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
}
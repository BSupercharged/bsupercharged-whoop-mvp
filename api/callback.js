import axios from 'axios';

export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).json({ success: false, error: 'Missing code parameter' });
  }

  try {
    const tokenResponse = await axios.post(
      'https://api.prod.whoop.com/oauth/oauth2/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
        redirect_uri: process.env.WHOOP_REDIRECT_URI,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const tokens = tokenResponse.data;

    // Optional: store tokens in DB or send to client
    return res.status(200).json({ success: true, tokens });
  } catch (error) {
    console.error('OAuth callback error:', error.response?.data || error.message);
    return res.status(401).json({
      success: false,
      data: error.response?.data || error.message,
    });
  }
}

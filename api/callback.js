import axios from 'axios';
import connectToDatabase from '../../lib/db';
import UserToken from '../../models/UserToken';

export default async function handler(req, res) {
  const code = req.query.code;
  const phoneNumber = req.query.phone || 'debug';

  if (!code) {
    return res.status(400).json({ success: false, error: 'Missing code in request' });
  }

  try {
    const tokenRes = await axios.post('https://api.prod.whoop.com/oauth/oauth2/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
        redirect_uri: process.env.WHOOP_REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const token = tokenRes.data;

    await connectToDatabase();

    await UserToken.findOneAndUpdate(
      { phoneNumber },
      {
        phoneNumber,
        accessToken: token.access_token,
        scope: token.scope,
        tokenType: token.token_type,
        expiresIn: token.expires_in
      },
      { upsert: true }
    );

    return res.status(200).json({ success: true, data: token });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.response?.data || err.message
    });
  }
}

import axios from 'axios';

export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    console.error('❌ Missing authorization code in request query');
    return res.status(400).json({ success: false, error: 'Missing code in request' });
  }

  console.log('✅ Received code:', code);

  const payload = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.WHOOP_CLIENT_ID,
    client_secret: process.env.WHOOP_CLIENT_SECRET,
    redirect_uri: process.env.WHOOP_REDIRECT_URI,
  });

  console.log('📦 Sending token request with payload:');
  console.log(Object.fromEntries(payload.entries()));

  try {
    const tokenResponse = await axios.post(
      'https://api.prod.whoop.com/oauth/oauth2/token',
      payload,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    console.log('✅ Token response:', tokenResponse.data);

    return res.status(200).json({
      success: true,
      data: tokenResponse.data,
    });
  } catch (error) {
    console.error('❌ Error exchanging code for token:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Error message:', error.message);
    }

    return res.status(error.response?.status || 500).json({
      success: false,
      data: error.response?.data || error.message,
    });
  }
}

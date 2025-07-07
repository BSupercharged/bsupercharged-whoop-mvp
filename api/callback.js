// pages/api/oauth/callback.js

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Missing code in query' });
  }

  // For now just log or return the code for debugging
  return res.status(200).json({ success: true, code, state });
}

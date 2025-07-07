
// /pages/api/callback.js

import { getToken } from "../../lib/whoop"; // adjust if needed
import { storeTokenForUser } from "../../lib/db"; // adjust if needed

export default async function handler(req, res) {
  const { code, state } = req.query;

  // Extract WhatsApp number from state param
  const whatsappMatch = state?.match(/whatsapp=([^&]+)/);
  const whatsapp = whatsappMatch ? decodeURIComponent(whatsappMatch[1]) : null;

  if (!whatsapp) {
    return res.status(400).json({ error: "Missing WhatsApp number" });
  }

  if (!code) {
    return res.status(400).json({ error: "Missing code" });
  }

  try {
    const tokenResponse = await getToken(code); // exchange WHOOP code for access_token
    await storeTokenForUser(whatsapp, tokenResponse);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

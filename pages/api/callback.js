import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const code = req.query.code;
  const state = req.query.state;

  // New parsing for "user610451196" format
  let whatsapp = "";
  if (typeof state === "string" && state.startsWith("user")) {
    whatsapp = state.substring(4); // after "user"
  }
  console.log("[DEBUG] Received state:", state);
  console.log("[DEBUG] Parsed WhatsApp:", whatsapp);

  if (!code || !whatsapp) {
    return res.status(400).json({ error: "Missing code or invalid WhatsApp number", debug: { code, state, whatsapp } });
  }

  // ... rest of your token exchange and DB logic ...
}


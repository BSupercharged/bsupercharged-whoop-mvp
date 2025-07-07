// /api/whatsapp.js
import { MongoClient } from 'mongodb';
import { OpenAI } from 'openai';
import Twilio from 'twilio';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const { Body, From } = req.body;

    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");

    const user = await tokens.findOne({ whatsapp: From });

    if (!user || !user.access_token || !user.expires_at || new Date(user.expires_at) < new Date()) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${encodeURIComponent(From)}`;
      await sendWhatsApp(`👋 To get started, connect your WHOOP account:\n👉 ${loginLink}`, From);
      await mongoClient.close();
      return res.status(200).send("Login link sent");
    }

    const recovery = await getLatestWhoopRecovery(user.access_token);
    const message = await getGPTReply(`My recovery score is ${recovery.recovery_score}, HRV is ${recovery.hrv}, RHR is ${recovery.rhr}, SpO2 is ${recovery.spo2}. What does this mean and what should I do today?`);

    await sendWhatsApp(message, From);
    await mongoClient.close();
    res.status(200).send("Response sent");
  } catch (err) {
    console.error("Error in WhatsApp handler:", err);
    res.status(500).send("Internal error");
  }
}

async function getGPTReply(message) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a health coach. Reply concisely based on WHOOP health metrics." },
      { role: "user", content: message }
    ]
  });
  return chat.choices[0].message.content.trim();
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text
  });
}

async function getLatestWhoopRecovery(token) {
  const res = await fetch("https://api.prod.whoop.com/developer/v1/recovery", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });
  if (!res.ok) throw new Error(`WHOOP API failed: ${res.status} - ${await res.text()}`);
  const json = await res.json();
  const latest = json.records?.[0]?.score || {};
  return {
    recovery_score: latest.recovery_score || 0,
    hrv: latest.hrv_rmssd_milli || 0,
    rhr: latest.resting_heart_rate || 0,
    spo2: latest.spo2_percentage || 0
  };
}



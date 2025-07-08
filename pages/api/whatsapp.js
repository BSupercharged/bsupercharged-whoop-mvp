import { MongoClient } from 'mongodb';
import { OpenAI } from 'openai';
import Twilio from 'twilio';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const { Body, From } = req.body;
    const phone = (From.replace('whatsapp:', '') || '').replace(/^\+/, '').trim();

    console.log(`[WhatsApp] Incoming from: ${From} Digits: ${phone}`);
    console.log(`[WhatsApp] Body: ${Body}`);

    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");
    const user = await tokens.findOne({ whatsapp: phone });
    console.log("[MongoDB] User found?", !!user);

    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `👋 To get started or re-authorise, connect your WHOOP account:\n👉 ${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).send("Login link sent");
    }

    // Try to get WHOOP recovery data
    let recovery;
    try {
      recovery = await getLatestWhoopRecovery(user.access_token);
      if (!recovery || !recovery.recovery_score) throw new Error("No data");
    } catch (err) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `⚠️ Your WHOOP login may have expired or no data found. Please log in again:\n👉 ${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).send("Login required");
    }

    // Use OpenAI for analysis (limit to 1500 chars)
    const message = await getGPTReply(
      `Act as an advanced health coach and biohacker. Here are my latest WHOOP data: Recovery score ${recovery.recovery_score}, HRV ${recovery.hrv}, RHR ${recovery.rhr}, SpO2 ${recovery.spo2}. Summarise yesterday in 3 lines. Limit your reply to 1500 characters.`
    );

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
      {
        role: "system",
        content:
          "You are an advanced health optimization coach. Reply concisely, limit to 1500 characters, and skip redundant explanations.",
      },
      { role: "user", content: message },
    ],
  });
  return chat.choices[0].message.content.trim().slice(0, 1500);
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text,
  });
}

async function getLatestWhoopRecovery(token) {
  const res = await fetch("https://api.prod.whoop.com/developer/v1/recovery", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`WHOOP API failed: ${res.status} - ${await res.text()}`);
  const json = await res.json();
  const latest = json.records?.[0]?.score || {};
  return {
    recovery_score: latest.recovery_score || 0,
    hrv: latest.hrv_rmssd_milli || 0,
    rhr: latest.resting_heart_rate || 0,
    spo2: latest.spo2_percentage || 0,
  };
}

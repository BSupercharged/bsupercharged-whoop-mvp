import { MongoClient } from 'mongodb';
import { OpenAI } from 'openai';
import Twilio from 'twilio';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const { Body, From } = req.body;
    const phone = From.replace("whatsapp:", ""); // e.g., +316...

    console.log(`[WhatsApp] Incoming message from: ${From}`);
    console.log(`[WhatsApp] Message body: ${Body}`);

    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");

    const user = await tokens.findOne({ whatsapp: phone });
    console.log("[MongoDB] User found?", !!user);

    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/login-redirect?whatsapp=${encodeURIComponent(phone)}`;
      await sendWhatsApp(
        `👋 To get started, connect your WHOOP account:\n👉 ${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).send("Login link sent");
    }

    // Logged in, fetch recovery data
    const recovery = await getLatestWhoopRecovery(user.access_token);
    const gptPrompt = `My recovery score is ${recovery.recovery_score}, HRV is ${recovery.hrv}, RHR is ${recovery.rhr}, SpO2 is ${recovery.spo2}. Give a concise summary and one recommendation.`;
    const message = await getGPTReply(gptPrompt);

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
          "You are a helpful health assistant. Interpret WHOOP metrics concisely and give 1 clear recommendation.",
      },
      { role: "user", content: message },
    ],
  });

  // Truncate to max 1600 characters
  const fullText = chat.choices[0].message.content.trim();
  return fullText.length > 1500 ? fullText.slice(0, 1490) + "..." : fullText;
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

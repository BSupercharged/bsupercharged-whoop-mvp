// /pages/api/whatsapp.js

import Twilio from "twilio";
import { parse } from "querystring";
import { OpenAI } from "openai";
import { MongoClient } from "mongodb";

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  let rawBody = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => { rawBody += chunk; });
    req.on("end", resolve);
  });
  const body = parse(rawBody);

  const { From, Body, NumMedia } = body;
  const phone = (From || "").replace("whatsapp:", "").replace("+", "");

  // 1. Media detection/handling
  let mediaNote = "";
  if (NumMedia && Number(NumMedia) > 0) {
    mediaNote = `Received ${NumMedia} media file(s).\n`;
    for (let i = 0; i < Number(NumMedia); i++) {
      mediaNote += `Media${i + 1}: ${body[`MediaUrl${i}`]} (type: ${body[`MediaContentType${i}`]})\n`;
      // Optional: Download/process file using fetch, e.g. for OCR
    }
  }

  // 2. Load user context from MongoDB
  let user, latestRecovery = {};
  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");
    user = await tokens.findOne({ whatsapp: phone });

    // 3. If not logged in, send login link
    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `👋 Advanced biohacker, please connect your WHOOP:\n👉 ${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).setHeader("Content-Type", "text/plain").end();
    }

    // 4. Try to get WHOOP Recovery (optional, skip error if fail)
    try {
      latestRecovery = await getLatestWhoopRecovery(user.access_token);
    } catch {}

    await mongoClient.close();
  } catch (dbErr) {
    await sendWhatsApp("❗ Database error. Try again soon.", From);
    return res.status(500).setHeader("Content-Type", "text/plain").end();
  }

  // 5. Build advanced GPT prompt
  let prompt = `You are a world-class longevity & health coach for advanced biohackers. 
Today's WHOOP: ${Object.keys(latestRecovery).length ? JSON.stringify(latestRecovery) : "Not available"}
Media note: ${mediaNote}
User said: "${Body}"

Instructions:
- Respond as an expert. Skip generic tips. Use all context from WHOOP, WhatsApp, or uploaded files. If media is a PDF/image, suggest blood marker or supplement analysis.
`;

  // 6. GPT reply
  let gptResponse;
  try {
    gptResponse = await getGPTReply(prompt);
  } catch {
    gptResponse = "OpenAI error: Unable to process your request right now.";
  }

  // 7. Reply to WhatsApp, always <=1600 chars
  try {
    await sendWhatsApp(gptResponse.length > 1600 ? gptResponse.slice(0, 1600) : gptResponse, From);
  } catch {}

  res.status(200).setHeader("Content-Type", "text/plain").end();
}

async function getGPTReply(message) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a world-class longevity & health coach for advanced biohackers. Always use context, skip generic advice." },
      { role: "user", content: message }
    ],
  });
  return chat.choices[0].message.content.trim();
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

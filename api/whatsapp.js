import axios from "axios";
import { OpenAI } from "openai";
import { MongoClient } from "mongodb";
import Twilio from "twilio";

export default async function handler(req, res) {
  const { Body, From } = req.body;

  const whoopData = await getLatestWhoopSleep();
  const responseText = await getGPTReply(Body || "How was my sleep?", whoopData);

  await sendWhatsApp(responseText, From);
  res.status(200).send("OK");
}

async function getLatestWhoopSleep() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("whoop_mvp");
  const tokenCol = db.collection("whoop_tokens");

  const tokenDoc = await tokenCol.findOne({}, { sort: { _id: -1 } });
  const accessToken = tokenDoc?.access_token;
  if (!accessToken) return null;

  const res = await fetch("https://api.prod.whoop.com/developer/v1/recovery", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  const recoveryData = await res.json();
  const today = recoveryData.records?.[0]?.score || null;

  await client.close();
  return today;
}

async function getGPTReply(userMessage, sleepData) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const sleepSummary = sleepData
    ? `Recovery score: ${sleepData.recovery_score}, RHR: ${sleepData.resting_heart_rate}, HRV: ${sleepData.hrv_rmssd_milli.toFixed(1)}ms, SpO2: ${sleepData.spo2_percentage}%, Skin Temp: ${sleepData.skin_temp_celsius}°C`
    : "No WHOOP data available.";

  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You're a health coach using WHOOP metrics to guide user wellness." },
      { role: "user", content: `${userMessage}\n\nLatest WHOOP recovery data:\n${sleepSummary}` }
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

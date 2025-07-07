// whatsapp.js

import axios from "axios";
import { OpenAI } from "openai";
import Twilio from "twilio";
import clientPromise from "@/lib/mongodb";

export default async function handler(req, res) {
  const { Body, From, NumMedia } = req.body;

  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");

    const userToken = await tokens.findOne({ phone_number: From });

    if (!userToken || isTokenExpired(userToken)) {
      const loginURL = `${process.env.VERCEL_URL}/api/login?phone=${encodeURIComponent(From)}`;
      await sendWhatsApp(`Please log in to WHOOP to link your data: ${loginURL}`, From);
      return res.status(200).send("Login link sent");
    }

    const responseText = await getGPTReply(Body || "How was my sleep?", userToken.access_token);
    await sendWhatsApp(responseText, From);
    res.status(200).send("OK");
  } catch (error) {
    console.error("Error in WhatsApp handler:", error);
    await sendWhatsApp("⚠️ Something went wrong. Please try again later.", From);
    res.status(500).send("Error");
  }
}

function isTokenExpired(tokenDoc) {
  const now = Math.floor(Date.now() / 1000);
  return !tokenDoc.expires_in || now >= tokenDoc.expires_in;
}

async function getGPTReply(message, accessToken) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Get latest WHOOP data
  const whoopRes = await fetch("https://api.prod.whoop.com/developer/v1/recovery/latest", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!whoopRes.ok) throw new Error(`WHOOP API failed: ${whoopRes.status} - ${await whoopRes.text()}`);
  const whoopData = await whoopRes.json();

  const prompt = `You are a health coach. Use this user's recovery data to answer: "${message}"
Recovery score: ${whoopData.recovery_score}
Resting HR: ${whoopData.resting_heart_rate}
HRV: ${whoopData.hrv_rmssd_milli}
SpO2: ${whoopData.spo2_percentage}
Skin temp: ${whoopData.skin_temp_celsius}`;

  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a concise but helpful health coach." },
      { role: "user", content: prompt },
    ],
  });

  return chat.choices[0].message.content.trim();
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({ from: process.env.TWILIO_WHATSAPP_NUMBER, to, body: text });
}

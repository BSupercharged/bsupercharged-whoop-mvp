import { OpenAI } from "openai";
import Twilio from "twilio";
import { MongoClient } from "mongodb";
import fetch from "node-fetch";

export default async function handler(req, res) {
  const { Body, From } = req.body;

  try {
    const whoopData = await getLatestWhoopSleep();
    const gptResponse = await getGPTReply(Body || "How was my sleep?", whoopData);
    await sendWhatsApp(gptResponse, From);
    res.status(200).send("OK");
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send("Internal Error: " + err.message);
  }
}

async function getLatestWhoopSleep() {
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db("whoop_mvp");
  const tokens = db.collection("whoop_tokens");
  const latest = await tokens.findOne({}, { sort: { _id: -1 } });
  await mongo.close();

  if (!latest?.access_token) throw new Error("No access token found");

  const whoopRes = await fetch("https://api.prod.whoop.com/developer/v1/sleep/recovery", {
    headers: {
      Authorization: `Bearer ${latest.access_token}`,
      Accept: "application/json"
    }
  });

  const rawText = await whoopRes.text();
  const contentType = whoopRes.headers.get("content-type") || "";

  if (!whoopRes.ok || !contentType.includes("application/json")) {
    throw new Error(`Expected JSON but got: ${contentType} — ${rawText}`);
  }

  const data = JSON.parse(rawText);
  return data?.records?.[0] || {};
}

async function getGPTReply(message, whoopData) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a WHOOP-based health coach. Answer only using the sleep and recovery metrics provided." },
      { role: "user", content: `Message: ${message}\n\nLatest WHOOP Recovery:\n${JSON.stringify(whoopData, null, 2)}` }
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

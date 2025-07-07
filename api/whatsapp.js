import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import Twilio from "twilio";
import fetch from "node-fetch";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  const { Body, From } = req.body;

  try {
    const responseText = await getGPTReply(Body || "How was my sleep?", From);
    await sendWhatsApp(responseText, From);
    res.status(200).send("OK");
  } catch (err) {
    console.error("Error in WhatsApp handler:", err.message);
    res.status(500).send("Error processing message.");
  }
}

async function getGPTReply(message, whatsappNumber) {
  const mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();
  const db = mongoClient.db("whoop_mvp");
  const collection = db.collection("whoop_tokens");

  const userToken = await collection.findOne({ whatsapp_number: whatsappNumber }, { sort: { _id: -1 } });

  if (!userToken?.access_token) {
    throw new Error("No access token for this user");
  }

  const response = await fetch("https://api.prod.whoop.com/developer/v1/recovery", {
    headers: {
      Authorization: `Bearer ${userToken.access_token}`
    }
  });

  const data = await response.json();

  if (!data?.records?.length) {
    throw new Error("No recovery records found");
  }

  const latest = data.records[0];
  const metrics = latest.score;
  const summary = `Your recovery score is ${metrics.recovery_score}, HRV is ${metrics.hrv_rmssd_milli.toFixed(1)}, RHR is ${metrics.resting_heart_rate}, and SpO2 is ${metrics.spo2_percentage.toFixed(1)}%.`;

  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a health coach. Reply concisely based on WHOOP recovery metrics." },
      { role: "user", content: `${message}\n\nMetrics: ${summary}` }
    ]
  });

  await mongoClient.close();
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

import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import Twilio from "twilio";

// WhatsApp handler
export default async function handler(req, res) {
  try {
    const { Body, From } = req.body;

    const recovery = await getLatestWhoopRecovery();
    const reply = await getGPTReply(Body || "How was my recovery?", recovery);

    await sendWhatsApp(reply, From);
    res.status(200).send("OK");
  } catch (err) {
    console.error("Error in WhatsApp handler:", err.message);
    res.status(500).send("Internal Server Error");
  }
}

// Fetch latest WHOOP recovery
async function getLatestWhoopRecovery() {
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db("whoop_mvp");
  const tokens = db.collection("whoop_tokens");
  const latest = await tokens.findOne({}, { sort: { _id: -1 } });
  await mongo.close();

  if (!latest?.access_token) throw new Error("No access token found");

  const whoopRes = await fetch("https://api.prod.whoop.com/developer/v1/recovery", {
    headers: {
      Authorization: `Bearer ${latest.access_token}`,
      Accept: "application/json"
    }
  });

  const rawText = await whoopRes.text();
  const contentType = whoopRes.headers.get("content-type") || "";

  if (!whoopRes.ok || !contentType.includes("application/json")) {
    throw new Error(`WHOOP API failed: ${whoopRes.status} - ${rawText}`);
  }

  const data = JSON.parse(rawText);
  return data?.records?.[0] || {};
}

// GPT reply
async function getGPTReply(message, recovery) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are a concise, supportive health coach. Use the user's WHOOP recovery data to respond helpfully. Avoid fluff."
      },
      {
        role: "user",
        content: `WHOOP Recovery Data: ${JSON.stringify(recovery)}. User said: ${message}`
      }
    ]
  });

  return chat.choices[0].message.content.trim();
}

// Send WhatsApp reply
async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text
  });
}

import axios from "axios";
import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import Twilio from "twilio";

export default async function handler(req, res) {
  const { Body, From } = req.body;

  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const collection = db.collection("whoop_tokens");

    const user = await collection.findOne({ whatsapp: From });
    await mongoClient.close();

    if (!user) {
      const loginUrl = `https://bsupercharged-whoop-mvp.vercel.app/api/login?whatsapp=${encodeURIComponent(From)}`;
      await sendWhatsApp(`Hi! Please connect your WHOOP data here: ${loginUrl}`, From);
      return res.status(200).send("Login link sent");
    }

    const responseText = await getGPTReply(Body || "How was my sleep?", user.access_token);
    await sendWhatsApp(responseText, From);
    res.status(200).send("OK");
  } catch (err) {
    console.error("WhatsApp handler error:", err);
    res.status(500).send("Internal Server Error");
  }
}

async function getGPTReply(message, token) {
  const sleep = await getLatestWhoopRecovery(token);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a health coach and biohacker. Reply concisely using WHOOP strain, recovery and sleep data. List any foods or supplements that may help this user." },
      { role: "user", content: `Message: ${message}\nData: ${JSON.stringify(sleep)}` }
    ]
  });
  return chat.choices[0].message.content.trim();
}

async function getLatestWhoopRecovery(token) {
  const url = "https://api.prod.whoop.com/developer/v1/recovery";
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data.records[0]; // latest
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text
  });
}

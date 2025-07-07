import { OpenAI } from "openai";
import Twilio from "twilio";

export default async function handler(req, res) {
  const { Body, From } = req.body;

  try {
    const latestSleep = await getLatestWhoopSleep();
    const gptReply = await getGPTReply(Body || "How was my sleep?", latestSleep);

    await sendWhatsApp(gptReply, From);
    res.status(200).send("OK");
  } catch (err) {
    console.error("Error in WhatsApp handler:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getLatestWhoopSleep() {
  const mongoUrl = process.env.MONGODB_URI;
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(mongoUrl);
  await client.connect();

  const tokenCollection = client.db("whoop_mvp").collection("whoop_tokens");
  const latest = await tokenCollection.findOne({}, { sort: { _id: -1 } });
  await client.close();

  if (!latest?.access_token) throw new Error("No access token found");

  const whoopRes = await fetch("https://api.prod.whoop.com/developer/v1/sleep", {
    headers: {
      Authorization: `Bearer ${latest.access_token}`,
      Accept: "application/json"
    }
  });

  const rawText = await whoopRes.text();
  if (!whoopRes.ok) throw new Error(`WHOOP API failed: ${whoopRes.status} - ${rawText}`);

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`Invalid JSON from WHOOP: ${rawText}`);
  }

  const latestSleep = data?.records?.[0];
  if (!latestSleep) throw new Error("No sleep data found");
  return latestSleep;
}

async function getGPTReply(userInput, sleepData) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "You are a concise AI health coach. Use WHOOP recovery and sleep data to reply helpfully and clearly."
      },
      {
        role: "user",
        content: `User asked: "${userInput}". Here is their latest sleep data:\n\n${JSON.stringify(sleepData, null, 2)}`
      }
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

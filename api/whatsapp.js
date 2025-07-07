import axios from "axios";
import { OpenAI } from "openai";
import { MongoClient } from "mongodb";
import Twilio from "twilio";

export default async function handler(req, res) {
  const { Body, From } = req.body;

  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");

    // Lookup user by WhatsApp number
    const user = await tokens.findOne({ whatsapp: From });
    if (!user || !user.access_token) {
      await sendWhatsApp("Please connect your WHOOP account first. Visit: https://bsupercharged-whoop-mvp.vercel.app", From);
      return res.status(401).send("Unauthorized");
    }

    // Handle message intent
    const input = Body.toLowerCase();
    let reply;

    if (input.includes("rem") || input.includes("deep") || input.includes("light") || input.includes("wake")) {
      reply = await getSleepStages(user.access_token);
    } else if (input.includes("how was my sleep") || input.includes("sleep summary")) {
      reply = await getSleepSummary(user.access_token);
    } else {
      reply = await getGPTReply(Body);
    }

    await sendWhatsApp(reply, From);
    res.status(200).send("OK");
  } catch (err) {
    console.error("WhatsApp handler error:", err);
    res.status(500).json({ error: "Server error", debug: err.message });
  }
}

async function getSleepSummary(token) {
  try {
    const response = await axios.get("https://api.prod.whoop.com/developer/v1/recovery", {
      headers: { Authorization: `Bearer ${token}` }
    });

    const latest = response.data.records?.[0];
    if (!latest) return "No recent recovery data found.";

    return `Your recovery score was ${latest.score.recovery_score}. HRV: ${Math.round(latest.score.hrv_rmssd_milli)} ms. RHR: ${latest.score.resting_heart_rate} bpm.`;
  } catch (err) {
    return `Error getting sleep summary: ${err.response?.status} - ${err.response?.data?.message || err.message}`;
  }
}

async function getSleepStages(token) {
  try {
    const summary = await axios.get("https://api.prod.whoop.com/developer/v1/sleep", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const sleepId = summary.data.records?.[0]?.sleep_id;
    if (!sleepId) return "No recent sleep data found.";

    const detail = await axios.get(`https://api.prod.whoop.com/developer/v1/sleep/${sleepId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const d = detail.data;
    const msToHr = ms => (ms / 3600000).toFixed(2);

    return `Last night: REM ${msToHr(d.rem_sleep_duration)}h, Deep ${msToHr(d.slow_wave_sleep_duration)}h, Light ${msToHr(d.light_sleep_duration)}h, Awake ${msToHr(d.wake_duration)}h.`;
  } catch (err) {
    return `Error getting sleep stage data: ${err.response?.status} - ${err.response?.data?.message || err.message}`;
  }
}

async function getGPTReply(message) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a WHOOP-integrated health coach. Use real data when available, and provide concise, friendly insights." },
      { role: "user", content: message }
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

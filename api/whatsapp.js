import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import Twilio from "twilio";
import fetch from "node-fetch";

export default async function handler(req, res) {
  const { Body, From } = req.body;

  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const users = db.collection("whoop_tokens");

    // Identify user by WhatsApp number
    const user = await users.findOne({ whatsapp: From }, { sort: { _id: -1 } });

    if (!user || !user.access_token) {
      const loginLink = `https://bsupercharged-whoop-mvp.vercel.app/api/login?whatsapp=${encodeURIComponent(From)}`;
      await sendWhatsApp(`👋 To get started, please log in to WHOOP here:\n\n${loginLink}`, From);
      return res.status(200).send("Login prompt sent");
    }

    // Fetch latest WHOOP recovery data
    const whoopRes = await fetch("https://api.prod.whoop.com/developer/v1/user/recovery/latest", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${user.access_token}`,
        Accept: "application/json"
      },
      timeout: 10000 // 10 second timeout
    });

    if (!whoopRes.ok) {
      if (whoopRes.status === 401) {
        const reloginLink = `https://bsupercharged-whoop-mvp.vercel.app/api/login?whatsapp=${encodeURIComponent(From)}`;
        await sendWhatsApp(`🔐 Your WHOOP session expired. Please log in again:\n\n${reloginLink}`, From);
        return res.status(200).send("Relogin prompt sent");
      }

      const raw = await whoopRes.text();
      throw new Error(`WHOOP API failed: ${whoopRes.status} - ${raw}`);
    }

    const recoveryData = await whoopRes.json();
    const prompt = `
Based on this WHOOP recovery data:
- Recovery score: ${recoveryData.score.recovery_score}
- RHR: ${recoveryData.score.resting_heart_rate}
- HRV: ${recoveryData.score.hrv_rmssd_milli}
- Skin temp: ${recoveryData.score.skin_temp_celsius.toFixed(1)}°C
- SpO2: ${recoveryData.score.spo2_percentage.toFixed(1)}%

Provide a concise health tip to improve recovery and sleep.`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const chat = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a health coach. Reply concisely based on WHOOP data." },
        { role: "user", content: prompt }
      ]
    });

    const reply = chat.choices[0].message.content.trim();
    await sendWhatsApp(reply, From);
    await mongoClient.close();
    res.status(200).send("Reply sent");
  } catch (err) {
    console.error("Error in WhatsApp handler:", err.message);
    await sendWhatsApp("⚠️ Something went wrong. Please try again later.", req.body?.From || "");
    res.status(500).json({ success: false, error: err.message });
  }
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text
  });
}

import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import Twilio from "twilio";
import fetch from "node-fetch";

// Utility: Always strip + and 'whatsapp:' prefix
function getDigits(wa) {
  return wa.replace(/^whatsapp:/, "").replace(/^\+/, "");
}

export default async function handler(req, res) {
  try {
    const { Body, From } = req.body || {};
    const phoneDigits = getDigits(From || "");

    // Vercel logging
    console.log(`[WhatsApp] Incoming from: ${From} Digits: ${phoneDigits}`);
    console.log(`[WhatsApp] Body: ${Body}`);

    // Connect to MongoDB
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");

    // Look up user by digits
    const user = await tokens.findOne({ whatsapp: phoneDigits });
    console.log("[MongoDB] User found?", !!user);

    // If no token/user found, send login link and exit
    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phoneDigits}`;
      await sendWhatsApp(
        `👋 To use this service, connect your WHOOP account:\n👉 ${loginLink}`,
        From
      );
      await mongoClient.close();
      // Always respond to Twilio so you avoid 11200 errors
      return res.status(200).send("Login link sent.");
    }

    // Try fetching recovery from WHOOP
    let recovery;
    try {
      recovery = await getLatestWhoopRecovery(user.access_token);
    } catch (err) {
      // Token probably expired, ask user to login again
      console.error("WHOOP API error:", err.message);
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phoneDigits}`;
      await sendWhatsApp(
        `⚠️ WHOOP authentication failed. Please log in again:\n👉 ${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).send("WHOOP token invalid; login link sent.");
    }

    // Pass metrics to OpenAI for a chat-based answer
    const prompt = `My recovery score is ${recovery.recovery_score}, HRV is ${recovery.hrv}, RHR is ${recovery.rhr}, SpO2 is ${recovery.spo2}. What does this mean and what should I do today?`;
    let message;
    try {
      message = await getGPTReply(prompt);
    } catch (err) {
      message = "Sorry, AI response failed. Try again later.";
      console.error("OpenAI error:", err.message);
    }

    await sendWhatsApp(message, From);
    await mongoClient.close();
    return res.status(200).send("All good.");

  } catch (err) {
    console.error("Fatal error in WhatsApp handler:", err);
    // Always respond something to Twilio to avoid 11200
    res.status(200).send("Error occurred.");
  }
}

async function getGPTReply(message) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "You are a helpful health assistant. Interpret WHOOP metrics concisely and give recommendations.",
      },
      { role: "user", content: message },
    ],
  });
  return chat.choices[0].message.content.trim();
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text.length > 1600 ? text.slice(0, 1599) : text, // Twilio 1600 char limit!
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



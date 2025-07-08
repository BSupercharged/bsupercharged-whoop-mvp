import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import Twilio from "twilio";
import fetch from "node-fetch";

export default async function handler(req, res) {
  let mongoClient;
  try {
    const { Body, From } = req.body;
    const phone = From.replace(/\D/g, '');

    console.log("[WhatsApp] Incoming from:", From, "Digits:", phone);
    console.log("[WhatsApp] Body:", Body);

    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");

    let user = await tokens.findOne({ whatsapp: phone });
    console.log("[MongoDB] User found?", !!user);

    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await safeSendWhatsApp(`👋 To get started, connect your WHOOP account:\n👉 ${loginLink}`, From);
      await mongoClient.close();
      res.status(200).send("Login link sent");
      return;
    }

    // *** THE KEY: inline try/catch ONLY around this block ***
    let recovery;
    try {
      recovery = await getLatestWhoopRecovery(user.access_token);
    } catch (err) {
      // *** THIS IS ALWAYS EXECUTED ON 401/ANY ERROR ***
      console.log("[WHOOP fetch error]", err.message);
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await safeSendWhatsApp(
        `🔑 Your WHOOP session expired or there was a problem. Please log in again:\n${loginLink}`,
        From
      );
      await mongoClient.close();
      res.status(200).send("Login link sent after error");
      return;
    }

    // If recovery fetched, reply using OpenAI
    const message = await getGPTReply(
      `My recovery score is ${recovery.recovery_score}, HRV is ${recovery.hrv}, RHR is ${recovery.rhr}, SpO2 is ${recovery.spo2}. What does this mean and what should I do today?`
    );
    await safeSendWhatsApp(message, From);
    await mongoClient.close();
    res.status(200).send("Response sent");
    return;
  } catch (err) {
    console.error("Error in WhatsApp handler [outer catch]:", err);
    if (req.body && req.body.From) {
      try {
        await safeSendWhatsApp(
          "❗️Sorry, something went wrong. Please try again or re-login to WHOOP.",
          req.body.From
        );
      } catch (err2) {}
    }
    if (mongoClient) await mongoClient.close();
    res.status(200).send("Internal error");
    return;
  }
}

// --- Rest of code unchanged below ---

async function safeSendWhatsApp(text, to) {
  try {
    if (!to) {
      console.log("[Twilio] No recipient provided, skipping send.");
      return;
    }
    const client = Twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    const resp = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to,
      body: text,
    });
    console.log("[Twilio] Sent WhatsApp message:", resp.sid, "to", to);
  } catch (e) {
    console.error("[Twilio]", e);
  }
}

async function getGPTReply(message) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful health assistant. Interpret WHOOP metrics concisely and give recommendations.",
      },
      { role: "user", content: message },
    ],
  });
  return chat.choices[0].message.content.trim().slice(0, 1500);
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


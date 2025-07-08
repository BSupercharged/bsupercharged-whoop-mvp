// /pages/api/whatsapp.js

import { MongoClient } from "mongodb";
import Twilio from "twilio";
import { parse } from "querystring";
import { OpenAI } from "openai";

// For raw webhook parsing
export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  let rawBody = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => { rawBody += chunk; });
    req.on("end", resolve);
  });
  const body = parse(rawBody);

  const { Body, From, NumMedia } = body;
  const phone = (From || "").replace("whatsapp:", "").replace("+", "");
  let debugLog = [];
  debugLog.push(`[WhatsApp] From: ${From}, Digits: ${phone}`);
  debugLog.push(`[Body]: ${Body}`);
  if (NumMedia && Number(NumMedia) > 0) debugLog.push(`[NumMedia]: ${NumMedia}`);

  // 1. Load user token/context
  let user, latestRecovery, pdfSummary = "";
  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");
    user = await tokens.findOne({ whatsapp: phone });
    debugLog.push(`[MongoDB] User found? ${!!user}`);

    // 2. (Optionally) check for PDF/blood marker context in DB
    // e.g., const pdfs = await db.collection("user_pdfs").findOne({ whatsapp: phone });
    // if (pdfs) pdfSummary = pdfs.summary; // Only if you have such a summary

    // 3. If not logged in, send login link
    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `👋 Welcome advanced biohacker! Please connect your WHOOP here:\n👉 ${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).end();
    }

    // 4. Try to get WHOOP Recovery
    try {
      latestRecovery = await getLatestWhoopRecovery(user.access_token);
      debugLog.push(`[WHOOP] Recovery: ${JSON.stringify(latestRecovery)}`);
    } catch (whoopErr) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `❗ WHOOP token expired or invalid. Please reconnect here:\n👉 ${loginLink}`,
        From
      );
      debugLog.push(`[WHOOP API error]: ${whoopErr.message}`);
      await mongoClient.close();
      return res.status(200).end();
    }

    await mongoClient.close();
  } catch (dbErr) {
    debugLog.push(`[MongoDB error]: ${dbErr.message}`);
    try { await sendWhatsApp("❗ Server/database error. Try again soon.", From); } catch {}
    return res.status(500).end();
  }

  // 5. Build advanced GPT prompt with context
  let prompt = `You are a world-class longevity & health coach, specializing in elite biohackers. Always respond as if speaking to an advanced user.
Here is today's WHOOP recovery:
- Recovery score: ${latestRecovery.recovery_score}
- HRV: ${latestRecovery.hrv}
- Resting heart rate: ${latestRecovery.rhr}
- SpO2: ${latestRecovery.spo2}

Additional context (if any): 
${pdfSummary ? "User blood/PDF summary: " + pdfSummary : "None available."}

Incoming WhatsApp message: "${Body}"

# Instructions
- Only provide advanced, actionable recommendations. Skip basics like “sleep more” or “stay hydrated.”
- If the user references blood markers, supplements, or uploads a PDF, assume they want a clinical or biomarker-level answer.
- If context is missing, request more data or ask what the user wants analyzed.
- NEVER provide generic tips unless specifically requested.
`;

  // 6. Send to OpenAI GPT
  let gptResponse;
  try {
    gptResponse = await getGPTReply(prompt);
  } catch (gptErr) {
    debugLog.push(`[OpenAI error]: ${gptErr.message}`);
    gptResponse = "OpenAI/GPT error: unable to process your request right now.";
  }

  // 7. Send response via WhatsApp, limit to 1600 chars
  try {
    await sendWhatsApp(
      gptResponse.length > 1600 ? gptResponse.slice(0, 1600) : gptResponse,
      From
    );
  } catch (smsErr) {
    debugLog.push(`[Twilio error]: ${smsErr.message}`);
  }

  // 8. Always end HTTP response empty for Twilio!
  res.status(200).end();
}

// -- helpers --

async function getGPTReply(message) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a world-class longevity & health coach for advanced biohackers. You skip generic advice and always respond with the latest evidence-based, advanced recommendations." },
      { role: "user", content: message }
    ],
  });
  return chat.choices[0].message.content.trim();
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text.length > 1600 ? text.slice(0, 1600) : text,
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

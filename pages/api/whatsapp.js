// /pages/api/whatsapp.js

import { MongoClient } from 'mongodb';
import { OpenAI } from 'openai';
import Twilio from 'twilio';
import fetch from 'node-fetch';
import Tesseract from 'tesseract.js';

// Helper: Clean phone number (no +, no whatsapp:)
function cleanPhone(str) {
  if (!str) return "";
  return str.replace("whatsapp:", "").replace(/^\+/, "").trim();
}

// Helper: Truncate to 1500 chars for Twilio
function truncate(str) {
  return (str || "").slice(0, 1500);
}

export default async function handler(req, res) {
  try {
    const { Body, From, NumMedia } = req.body;
    const phone = cleanPhone(From);

    // --- DB connect
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");
    const files = db.collection("user_files");

    // --- MEDIA/IMAGE: OCR upload support ---
    if (parseInt(NumMedia, 10) > 0) {
      const mediaUrl = req.body['MediaUrl0'];
      const mediaType = req.body['MediaContentType0'];

      if (mediaType && mediaType.startsWith('image/')) {
        const imageBuffer = await fetch(mediaUrl).then(r => r.arrayBuffer());
        const { data: { text } } = await Tesseract.recognize(Buffer.from(imageBuffer), "eng");
        // Store OCR for this user
        await files.insertOne({ whatsapp: phone, type: 'ocr', text, created_at: new Date() });
        await sendWhatsApp("📝 Your health/lab report image was processed and saved! I’ll use this for future health advice.", From);
        await mongoClient.close();
        return res.status(200).send("OCR done");
      }
      // PDF support can be added here
    }

    // --- FIND USER/TOKEN ---
    const user = await tokens.findOne({ whatsapp: phone });
    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `👋 Hi! To connect your WHOOP account, tap to login here:\n${loginLink}\n\nIf you don't use WHOOP, reply with your wearable or upload a lab PDF/photo!`,
        From
      );
      await mongoClient.close();
      return res.status(200).send("Login sent");
    }

    // --- FETCH latest WHOOP RECOVERY (yesterday) ---
    let latestData = null;
    try {
      latestData = await getLatestWhoopRecovery(user.access_token);
    } catch (err) {
      // Token expired or revoked
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `🔑 Please reconnect WHOOP here: ${loginLink}\n\nThis keeps your data fresh and advice accurate!`,
        From
      );
      await mongoClient.close();
      return res.status(200).send("Need re-login");
    }

    // --- LOAD user's files/OCR context ---
    const latestOCR = await files.find({ whatsapp: phone }).sort({ created_at: -1 }).limit(2).toArray();
    const ocrSummary = latestOCR.map(f => f.text).join("\n\n").slice(0, 1500);

    // --- CRAFT PROMPT (for first message, "Hi"/start, show summary, else converse) ---
    let prompt = "";
    if (/^(hi|start|hello|hey)$/i.test(Body.trim()) || Body.trim().length < 4) {
      prompt = `You are an advanced health AI for a biohacker with wearable (WHOOP) and blood test data. Give a *summary analysis* of the latest recovery, HRV, RHR, and SpO2 from yesterday. If there are any lab/blood markers or OCR'd documents, include them in your summary. Keep it concise and do NOT repeat numbers in every reply.`
    } else {
      prompt = `
You are an advanced biohacker assistant with access to WHOOP wearable metrics and uploaded lab/blood test data. 
Respond to the user's query *using the latest health context*, including previous lab results or OCR text if relevant.
If there are no files, remind the user to upload PDFs or lab images via WhatsApp for richer analysis. Keep it conversational, under 1500 characters, and do NOT repeat wearable metrics unless directly relevant to the user's question.
User message: ${Body}
WHOOP summary: Recovery score: ${latestData.recovery_score}, HRV: ${latestData.hrv}, RHR: ${latestData.rhr}, SpO2: ${latestData.spo2}
Lab/ocr context: ${ocrSummary || '[No files uploaded yet]'}
      `.replace(/\n+/g, " ").trim();
    }

    // --- GPT REPLY ---
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const chat = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 700, // About 1500 characters
      messages: [
        {
          role: "system",
          content:
            "You are an expert AI health coach for an advanced biohacker. Use all context (wearables, lab, OCR) to provide insightful, actionable advice. NEVER repeat basic wearable stats unless directly asked. Always keep replies under 1500 characters and reference uploaded labs or files when possible.",
        },
        { role: "user", content: prompt }
      ],
    });

    // --- Send truncated response ---
    const reply = truncate(chat.choices[0].message.content);
    await sendWhatsApp(reply, From);
    await mongoClient.close();
    return res.status(200).send("Response sent");
  } catch (err) {
    console.error("Error in WhatsApp handler:", err);
    // Fallback user-friendly message
    try { await sendWhatsApp("⚠️ Sorry, something went wrong processing your request. Please try again or reconnect your account.", req.body.From); } catch {}
    return res.status(500).send("Internal error");
  }
}

// ----- HELPERS -----
async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text,
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

import Twilio from "twilio";
import { parse } from "querystring";
import { OpenAI } from "openai";
import { MongoClient } from "mongodb";
import fetch from "node-fetch";
import Tesseract from "tesseract.js";
import pdfParse from "pdf-parse";

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

  const { From, Body, NumMedia } = body;
  const phone = (From || "").replace("whatsapp:", "").replace("+", "");

  console.log(`[WhatsApp] Incoming from: ${From} Digits: ${phone}`);
  console.log(`[WhatsApp] Body: ${Body}`);
  if (NumMedia && Number(NumMedia) > 0) {
    for (let i = 0; i < Number(NumMedia); i++) {
      console.log(`[WhatsApp] MediaUrl${i}:`, body[`MediaUrl${i}`], `(type: ${body[`MediaContentType${i}`]})`);
    }
  }

  // --- 1. Media: OCR image or PDF ---
  let mediaNote = "", ocrResult = "";
  if (NumMedia && Number(NumMedia) > 0) {
    for (let i = 0; i < Number(NumMedia); i++) {
      const mediaType = body[`MediaContentType${i}`];
      const mediaUrl = body[`MediaUrl${i}`];
      if (mediaType && mediaType.startsWith("image/")) {
        try {
          const ocrText = await fetchAndOcrImage(mediaUrl);
          ocrResult += `🖼️ OCR result from your image: "${ocrText.slice(0, 300)}"${ocrText.length > 300 ? '...' : ''}\n`;
        } catch (err) {
          ocrResult += `❗ Could not process the image for OCR.\n`;
        }
      } else if (mediaType === "application/pdf") {
        try {
          const pdfText = await fetchAndParsePDF(mediaUrl);
          ocrResult += `📄 Text extracted from your PDF:\n"${pdfText.slice(0, 600)}"${pdfText.length > 600 ? '...' : ''}\n`;
        } catch (err) {
          ocrResult += `❗ Could not process the PDF. (${err.message})\n`;
        }
      } else {
        mediaNote += `Received media file ${i + 1}: ${mediaUrl} (type: ${mediaType})\n`;
      }
    }
    if (!ocrResult && mediaNote) {
      ocrResult = `Received your media. PDF and advanced doc analysis is supported!`;
    }
  }

  // --- 2. Load user context from MongoDB ---
  let user, latestRecovery = {};
  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");
    user = await tokens.findOne({ whatsapp: phone });

    // Not logged in: send friendly login prompt
    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `👋 Hi! To get your full health insights, please link your WHOOP account here:\n${loginLink}\n(Soon: support for other wearables like Ultrahuman!)`,
        From
      );
      await mongoClient.close();
      return res.status(200).setHeader("Content-Type", "text/plain").end();
    }

    // Try to get WHOOP Recovery (skip error if fail)
    try {
      latestRecovery = await getLatestWhoopRecovery(user.access_token);
      console.log("[WHOOP] Latest Recovery:", latestRecovery);
    } catch (err) {
      console.log("[WHOOP] Could not get recovery data:", err.message);
    }

    await mongoClient.close();
  } catch (dbErr) {
    console.log("[MongoDB] ERROR:", dbErr.message);
    await sendWhatsApp("😬 Oops, we're having a little trouble accessing your data. Please try again in a bit!", From);
    return res.status(500).setHeader("Content-Type", "text/plain").end();
  }

  // --- 3. Build advanced GPT prompt ---
  let prompt = `You are a friendly but highly advanced health and longevity coach for expert biohackers.
Context:
- WHOOP recovery: ${Object.keys(latestRecovery).length ? JSON.stringify(latestRecovery) : "Not available"}
- OCR from images or PDFs: ${ocrResult.trim() || "None"}
- Other media: ${mediaNote ? mediaNote.trim() : "None"}
- User said: "${Body}"

Instructions:
- Be concise, insightful, and friendly. Avoid generic tips.
- If there is little context, or something seems unclear or unusual, ask the user to share more info or upload a PDF, bloodwork, or say what wearable they're using.
- If an OCR or PDF result is present, try to interpret it (e.g., lab results, supplements).
- Mention that support for other wearables like Ultrahuman is coming soon.
- Always reply conversationally, and invite the user to clarify or send more details if needed.
`;

  // --- 4. If basically nothing to work with, prompt user ---
  if (!Body || Body.trim().length < 3) {
    await sendWhatsApp(
      `Hi there! 😊 Could you tell me a bit more about what you'd like to know, or upload a lab report, supplement list, or ask about your recovery?`,
      From
    );
    return res.status(200).setHeader("Content-Type", "text/plain").end();
  }

  // --- 5. GPT reply (friendly, advanced, context-aware) ---
  let gptResponse;
  try {
    gptResponse = await getGPTReply(prompt);
    console.log("[GPT] Reply:", gptResponse.slice(0, 80) + "...");
  } catch (err) {
    console.log("[GPT] Error:", err.message);
    gptResponse = "Sorry, I'm having trouble connecting to my brain (OpenAI)! Please try again soon. 😊";
  }

  // --- 6. WhatsApp reply (<=1600 chars) ---
  try {
    await sendWhatsApp(gptResponse.length > 1600 ? gptResponse.slice(0, 1600) : gptResponse, From);
  } catch (err) {
    console.log("[Twilio] Error sending WhatsApp:", err.message);
  }

  res.status(200).setHeader("Content-Type", "text/plain").end();
}

// --- OCR: Download and parse image ---
async function fetchAndOcrImage(mediaUrl) {
  // Twilio media URLs require basic auth: your ACCOUNT_SID as user, AUTH_TOKEN as pass
  const res = await fetch(mediaUrl, {
    headers: {
      Authorization: "Basic " + Buffer.from(
        process.env.TWILIO_ACCOUNT_SID + ":" + process.env.TWILIO_AUTH_TOKEN
      ).toString("base64"),
    },
  });
  const buffer = await res.buffer();

  // OCR the image buffer (Tesseract)
  const { data: { text } } = await Tesseract.recognize(buffer, "eng");
  return text.trim();
}

// --- PDF: Download and parse PDF file ---
async function fetchAndParsePDF(mediaUrl) {
  const res = await fetch(mediaUrl, {
    headers: {
      Authorization: "Basic " + Buffer.from(
        process.env.TWILIO_ACCOUNT_SID + ":" + process.env.TWILIO_AUTH_TOKEN
      ).toString("base64"),
    },
  });
  const buffer = await res.buffer();

  // Parse PDF
  const data = await pdfParse(buffer);
  return data.text.trim();
}

async function getGPTReply(message) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a friendly but advanced health, longevity and biohacking coach who gets a lot of knowledge from Dan Garner and Andy Galpin. Always use all context (WHOOP, user info, OCR, PDFs, media), reply conversationally, never generic, and ask for more context if things are unclear or minimal." },
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

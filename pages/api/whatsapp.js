import Twilio from "twilio";
import { parse } from "querystring";
import { OpenAI } from "openai";
import { MongoClient } from "mongodb";
import fetch from "node-fetch";
import Tesseract from "tesseract.js";
import pdfParse from "pdf-parse";
import { PDFDocument } from "pdf-lib"; // Add pdf-lib for page images

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  let rawBody = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => { rawBody += chunk; });
    req.on("end", resolve);
  });
  const body = parse(rawBody);

  const { From, Body, NumMedia } = body;
  const phone = (From || "").replace("whatsapp:", "").replace("+", "");
  let mediaNote = "", ocrResult = "";

  // --- 1. OCR for images & PDFs ---
  if (NumMedia && Number(NumMedia) > 0) {
    for (let i = 0; i < Number(NumMedia); i++) {
      const mediaType = body[`MediaContentType${i}`];
      const mediaUrl = body[`MediaUrl${i}`];
      if (mediaType && mediaType.startsWith("image/")) {
        try {
          const ocrText = await fetchAndOcrImage(mediaUrl);
          ocrResult += `OCR result: "${ocrText.slice(0, 350)}"${ocrText.length > 350 ? '...' : ''}\n`;
        } catch (err) {
          ocrResult += `Could not process the image for OCR.\n`;
        }
      } else if (mediaType === "application/pdf") {
        try {
          ocrResult += await smartPDFExtract(mediaUrl);
        } catch (err) {
          ocrResult += `Could not process the PDF. (${err.message})\n`;
        }
      } else {
        mediaNote += `Received media file ${i + 1}: ${mediaUrl} (type: ${mediaType})\n`;
      }
    }
  }

  // --- 2. Load user context ---
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
        `Hi! Please connect your WHOOP account here: ${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).setHeader("Content-Type", "text/plain").end();
    }
    try {
      latestRecovery = await getLatestWhoopRecovery(user.access_token);
    } catch {}
    await mongoClient.close();
  } catch {}

  // --- 3. Craft prompt ---
  // Only include the metrics if the user asks for "details", "show", or similar
  let bodyLC = (Body || "").toLowerCase();
  let addWhoopDetails = ["detail", "raw", "show", "data", "numbers", "json"].some(w => bodyLC.includes(w));
  let whoopSummary = "";
  if (latestRecovery && Object.keys(latestRecovery).length) {
    if (addWhoopDetails) {
      whoopSummary = `WHOOP raw recovery data: ${JSON.stringify(latestRecovery)}\n`;
    } else {
      whoopSummary = `Your current metrics: recovery score ${latestRecovery.recovery_score}, HRV ${latestRecovery.hrv}, RHR ${latestRecovery.rhr}, SpO2 ${latestRecovery.spo2}.\n`;
    }
  }

  // Only mention metrics if relevant or requested
  let systemPrompt = `You are a friendly but advanced health and biohacking assistant for expert users. Only show metrics if the user asks for details or numbers. Use all available context (OCR, PDF, WHOOP) but keep replies concise and actionable.`;
  let context = [
    whoopSummary && addWhoopDetails ? whoopSummary : "", // Only add raw data if requested
    ocrResult ? `Extracted info: ${ocrResult}` : "",
    mediaNote ? `Other media: ${mediaNote}` : "",
    `User: "${Body}"`
  ].filter(Boolean).join("\n");

  if (!Body || Body.trim().length < 3) {
    await sendWhatsApp(
      `Hi! 😊 Can you tell me a bit more, or upload a lab report, supplement list, or ask about your recovery?`,
      From
    );
    return res.status(200).setHeader("Content-Type", "text/plain").end();
  }

  let prompt = `Context:\n${context}\n\nInstructions:\n- Reply concisely and conversationally.\n- If you can't find useful data or user question is unclear, ask them for more detail or to resend info.\n- Do not repeat all WHOOP metrics unless specifically asked.\n- Use advanced reasoning (e.g. interpret OCR/bloodwork if possible, or ask for a clearer PDF).\n`;

  // --- 4. GPT reply ---
  let gptResponse;
  try {
    gptResponse = await getGPTReply(systemPrompt, prompt);
    // If GPT tries to paste raw data, trim it out unless user asked for it
    if (!addWhoopDetails) {
      gptResponse = gptResponse.replace(/(WHOOP raw recovery data:|{"recovery_score":[^}]+})/gi, "");
    }
    gptResponse = gptResponse.slice(0, 1600);
  } catch {
    gptResponse = "Sorry, something went wrong—please try again in a moment!";
  }
  try { await sendWhatsApp(gptResponse, From); } catch {}
  res.status(200).setHeader("Content-Type", "text/plain").end();
}

// --- OCR Helpers ---
async function fetchAndOcrImage(mediaUrl) {
  const res = await fetch(mediaUrl, {
    headers: {
      Authorization: "Basic " + Buffer.from(
        process.env.TWILIO_ACCOUNT_SID + ":" + process.env.TWILIO_AUTH_TOKEN
      ).toString("base64"),
    },
  });
  const buffer = await res.buffer();
  const { data: { text } } = await Tesseract.recognize(buffer, "eng");
  return text.trim();
}

// --- PDF Helpers: Try text, fallback to OCR per page ---
async function smartPDFExtract(mediaUrl) {
  const res = await fetch(mediaUrl, {
    headers: {
      Authorization: "Basic " + Buffer.from(
        process.env.TWILIO_ACCOUNT_SID + ":" + process.env.TWILIO_AUTH_TOKEN
      ).toString("base64"),
    },
  });
  const buffer = await res.buffer();

  // Try to extract text directly
  let parsed = await pdfParse(buffer);
  if (parsed.text && parsed.text.replace(/\W/g, "").length > 40) {
    return `PDF text: "${parsed.text.slice(0, 600)}"${parsed.text.length > 600 ? '...' : ''}`;
  }
  // If little or no text, try to OCR each page image
  let textResult = "";
  try {
    const pdfDoc = await PDFDocument.load(buffer);
    for (let i = 0; i < pdfDoc.getPageCount(); i++) {
      const page = pdfDoc.getPage(i);
      const png = await page.render({ format: "png" });
      const ocrText = await Tesseract.recognize(png, "eng");
      textResult += ocrText.data.text + "\n";
    }
    return `OCR from scanned PDF: "${textResult.slice(0, 800)}"${textResult.length > 800 ? '...' : ''}`;
  } catch (err) {
    return "Tried to scan PDF pages, but couldn't extract any useful text.";
  }
}

async function getGPTReply(system, userPrompt) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt }
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

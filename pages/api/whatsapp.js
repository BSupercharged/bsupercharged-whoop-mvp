import Twilio from "twilio";
import { parse } from "querystring";
import { OpenAI } from "openai";
import { MongoClient } from "mongodb";
import fetch from "node-fetch";
import pdfParse from "pdf-parse";
import FormData from "form-data";

export const config = { api: { bodyParser: false } };

function cleanOcrText(text) {
  if (!text) return "";
  let out = text.replace(/([A-Za-z\-\+\/]+):([0-9])/g, "$1: $2");
  out = out.replace(/([0-9])([a-zA-Z%\/]+)/g, "$1 $2");
  out = out.replace(/([0-9]\s*[a-zA-Z%\/]*)\s*([A-Z][A-Za-z\-]+:)/g, "$1\n$2");
  out = out.replace(/\s{2,}/g, " ");
  return out;
}

export default async function handler(req, res) {
  let rawBody = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => { rawBody += chunk; });
    req.on("end", resolve);
  });
  const body = parse(rawBody);

  const { From, Body, NumMedia } = body;
  const phone = (From || "").replace("whatsapp:", "").replace("+", "");
  let extractedText = "", cleanedText = "", mediaNote = "";
  let mongoClient, user = null;

  // --- OCR for images and PDFs ---
  if (NumMedia && Number(NumMedia) > 0) {
    for (let i = 0; i < Number(NumMedia); i++) {
      const mediaType = body[`MediaContentType${i}`];
      const mediaUrl = body[`MediaUrl${i}`];
      if (mediaType === "application/pdf") {
        try {
          extractedText += await fetchAndParsePDF(mediaUrl);
        } catch (err) {
          try { extractedText += await cloudOCR(mediaUrl); }
          catch (err2) { mediaNote += `Could not OCR PDF. (${err2.message})\n`; }
        }
      } else if (mediaType && mediaType.startsWith("image/")) {
        try { extractedText += await cloudOCR(mediaUrl); }
        catch (err) { mediaNote += `Could not OCR image. (${err.message})\n`; }
      } else {
        mediaNote += `Unsupported media: ${mediaType}\n`;
      }
    }
  }
  cleanedText = cleanOcrText(extractedText);
  const markers = {};
  (cleanedText || "").split(/\n/).forEach(line => {
    let m = line.match(/([A-Za-z\(\)\-\+0-9\/ ]{2,15})[: ]+([0-9\.]+)/);
    if (m) markers[m[1].replace(/\s+/g,'').replace(/[^A-Za-z0-9\-]/g,'')] = parseFloat(m[2]);
  });

  let pastMarkersSummary = "";
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");
    const bloods = db.collection("blood_results");
    user = await tokens.findOne({ whatsapp: phone });

    // Save new bloods if found
    if (Object.keys(markers).length > 0) {
      await bloods.insertOne({
        whatsapp: phone,
        date: new Date(),
        markers,
        raw_text: extractedText,
        cleaned_text: cleanedText,
        created_at: new Date()
      });
      mediaNote += `Blood results saved: ${Object.keys(markers).join(', ')}.\n`;
    }

    // Get past bloods for summary
    const pastBloods = await bloods.find({ whatsapp: phone })
      .sort({ date: -1 })
      .limit(10)
      .toArray();
    if (pastBloods.length) {
      pastMarkersSummary = pastBloods.map((r, idx) => {
        const date = r.date ? new Date(r.date).toISOString().split("T")[0] : "Unknown";
        const summary = Object.entries(r.markers)
          .map(([k, v]) => `${k}: ${v}`).join(", ");
        return `Test ${idx + 1} (${date}): ${summary}`;
      }).join("\n");
    }

    // --- WHOOP fallback logic ---
    const whoopKeywords = [
      "whoop", "recovery", "hrv", "strain", "sleep", "resting heart rate"
    ];
    const wantsWhoop = whoopKeywords.some(k =>
      (Body || "").toLowerCase().includes(k)
    );
    let sendLogin = false;

    // --- WHOOP Data Fetch (with fallback on 401) ---
    let whoopProfile = null, whoopRecovery = null, whoopSleep = null, whoopStrain = null;
    if (user && user.access_token) {
      // try/catch for each; if 401 or missing, reauth and early exit
      const today = new Date();
      const lastYear = new Date(today); lastYear.setFullYear(today.getFullYear() - 1);
      const start = lastYear.toISOString().split("T")[0];
      const end = today.toISOString().split("T")[0];

      try {
        whoopProfile = await fetchWhoop("user/profile/basic", user.access_token);
        if (!whoopProfile.user_id) throw new Error("401");
      } catch {
        await tokens.updateOne({ whatsapp: phone }, { $unset: { access_token: "" } });
        sendLogin = true;
      }

      try {
        whoopRecovery = await fetchWhoop(`recovery?start=${start}&end=${end}`, user.access_token);
        if (!Array.isArray(whoopRecovery.records)) throw new Error("401");
      } catch {
        await tokens.updateOne({ whatsapp: phone }, { $unset: { access_token: "" } });
        sendLogin = true;
      }

      try {
        whoopSleep = await fetchWhoop(`sleep?start=${start}&end=${end}`, user.access_token);
        if (!Array.isArray(whoopSleep.records)) whoopSleep = null;
      } catch { whoopSleep = null; }

      try {
        whoopStrain = await fetchWhoop(`workout?start=${start}&end=${end}`, user.access_token);
        if (!Array.isArray(whoopStrain.records)) whoopStrain = null;
      } catch { whoopStrain = null; }
    }

    // Always send login if necessary (NO reauth loop!)
    if (
      sendLogin ||
      (!user || !user.access_token) && wantsWhoop
    ) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `🔐 To access your WHOOP data, please log in here:\n${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).setHeader("Content-Type", "text/plain").end();
    }

    // Compose OpenAI prompt (context-aware)
    let systemPrompt = `You are an advanced, friendly health assistant for biohackers. Use all available context from blood test history, current bloods, and WHOOP metrics (including up to a year of data if present). Don't dump data unless asked for details. If you need more info, ask the user for specifics.`;
    let userPrompt = `User: "${Body}"\n`;
    if (Object.keys(markers).length) userPrompt += `\nNew blood results: ${JSON.stringify(markers)}`;
    if (pastMarkersSummary) userPrompt += `\nPrevious blood markers:\n${pastMarkersSummary}`;
    if (mediaNote) userPrompt += `\nNote: ${mediaNote}`;
    if (cleanedText && !Object.keys(markers).length) userPrompt += `\nExtracted: ${cleanedText}`;
    if (whoopProfile && whoopProfile.user_id) userPrompt += `\nWHOOP profile: ${JSON.stringify(whoopProfile)}`;
    if (whoopRecovery && whoopRecovery.records) userPrompt += `\nRecent WHOOP recovery (sample): ${JSON.stringify(whoopRecovery.records.slice(0, 5))}`;
    if (whoopSleep && whoopSleep.records) userPrompt += `\nRecent WHOOP sleep (sample): ${JSON.stringify(whoopSleep.records.slice(0, 3))}`;
    if (whoopStrain && whoopStrain.records) userPrompt += `\nRecent WHOOP workouts (sample): ${JSON.stringify(whoopStrain.records.slice(0, 2))}`;

    let gptResponse = "";
    try {
      gptResponse = await getGPTReply(systemPrompt, userPrompt);
      gptResponse = gptResponse.slice(0, 1600); // Twilio limit
    } catch {
      gptResponse = "Sorry, something went wrong!";
    }
    await sendWhatsApp(gptResponse, From);
    await mongoClient.close();
    res.status(200).setHeader("Content-Type", "text/plain").end();
  } catch (err) {
    try { if (mongoClient) await mongoClient.close(); } catch {}
    res.status(500).send("Internal error");
  }
}

// --- Utility Functions ---
async function fetchWhoop(path, token) {
  const base = "https://api.prod.whoop.com/developer/v1/";
  const url = path.startsWith("http") ? path : base + path;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) throw new Error("401");
  if (!res.ok) return {};
  try { return await res.json(); } catch { return {}; }
}

async function fetchAndParsePDF(mediaUrl) {
  const res = await fetch(mediaUrl, {
    headers: {
      Authorization: "Basic " + Buffer.from(
        process.env.TWILIO_ACCOUNT_SID + ":" + process.env.TWILIO_AUTH_TOKEN
      ).toString("base64"),
    },
  });
  const buffer = await res.buffer();
  let parsed = await pdfParse(buffer);
  return parsed.text.trim();
}

async function cloudOCR(mediaUrl) {
  const fileRes = await fetch(mediaUrl, {
    headers: {
      Authorization: "Basic " + Buffer.from(
        process.env.TWILIO_ACCOUNT_SID + ":" + process.env.TWILIO_AUTH_TOKEN
      ).toString("base64"),
    },
  });
  const fileBuffer = await fileRes.arrayBuffer();
  const ocrRes = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: process.env.OCR_SPACE_API_KEY },
    body: (() => {
      const form = new FormData();
      form.append("file", Buffer.from(fileBuffer), "upload.png");
      form.append("language", "eng");
      form.append("isOverlayRequired", "false");
      return form;
    })(),
  });
  const result = await ocrRes.json();
  if (!result || !result.ParsedResults || !result.ParsedResults[0])
    throw new Error("No OCR result");
  return result.ParsedResults[0].ParsedText.trim();
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




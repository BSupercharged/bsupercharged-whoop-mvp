// pages/api/whatsapp.js

import Twilio from "twilio";
import { parse } from "querystring";
import { OpenAI } from "openai";
import { MongoClient } from "mongodb";
import fetch from "node-fetch";
import pdfParse from "pdf-parse";
import FormData from "form-data";

export const config = { api: { bodyParser: false } };

// ----------- CLEAN OCR TEXT FUNCTION ------------
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
  let extractedText = "";
  let cleanedText = "";
  let mediaNote = "";

  // -- OCR Logic for files (images/PDFs) --
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

  // Clean and save the OCR text
  cleanedText = cleanOcrText(extractedText);

  // --- Extract blood markers (simple regex for demo) ---
  const markers = {};
  (cleanedText || "").split(/\n/).forEach(line => {
    let m = line.match(/([A-Za-z\(\)\-\+0-9\/ ]{2,15})[: ]+([0-9\.]+)/);
    if (m) markers[m[1].replace(/\s+/g,'').replace(/[^A-Za-z0-9\-]/g,'')] = parseFloat(m[2]);
  });

  let mongoClient, user = null;
  let pastMarkersSummary = "";
  let chartRequested = false;
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");
    const bloods = db.collection("blood_results");
    user = await tokens.findOne({ whatsapp: phone });

    // Store blood result if any markers found
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

    // Fetch past blood results for summary (up to 10, newest first)
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

    // --- Chart reply if asked for a marker trend ---
    const chartMarker = getChartRequestMarker(Body);
    if (chartMarker) {
      const lastResults = await bloods.find({ whatsapp: phone, [`markers.${chartMarker}`]: { $exists: true } })
        .sort({ date: -1 })
        .limit(10)
        .toArray();
      if (lastResults.length) {
        chartRequested = true;
        const labels = lastResults.map(r => r.date.toISOString().split('T')[0]).reverse();
        const values = lastResults.map(r => r.markers[chartMarker]).reverse();
        const chartUrl = buildQuickChartUrl(labels, values, chartMarker);
        await sendWhatsApp(
          `Here's your ${chartMarker} trend for last ${labels.length} blood tests:`,
          From,
          chartUrl
        );
        await mongoClient.close();
        return res.status(200).setHeader("Content-Type", "text/plain").end();
      } else {
        mediaNote += `No data found for ${chartMarker}.\n`;
      }
    }

    // WHOOP: Try to use, but not required. If expired, prompt to login again.
    let whoop = null;
    let whoopError = null;
    if (user && user.access_token) {
      try {
        whoop = await fetchWhoop("user/profile/basic", user.access_token);
        if (whoop.error || whoop.status === 401) {
          whoopError = "expired";
        }
      } catch (e) {
        whoopError = "expired";
      }
    }

    if (whoopError === "expired") {
      // Remove access token from Mongo
      await tokens.updateOne({ whatsapp: phone }, { $unset: { access_token: "" } });
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `Your WHOOP connection has expired. Please log in again: ${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).setHeader("Content-Type", "text/plain").end();
    }

    // Compose GPT prompt
    let systemPrompt = `You are an advanced, friendly health assistant for biohackers. Use all available context from current and past blood tests, PDF/image text (after fixing spacing), and WHOOP metrics if present. Never dump raw data unless user asks for "details" or "chart". If context is insufficient, politely ask for more info or suggest what the user might provide.`;
    let userPrompt = `User: "${Body}"\n`;
    if (Object.keys(markers).length) userPrompt += `\nNew blood results: ${JSON.stringify(markers)}`;
    if (pastMarkersSummary) userPrompt += `\nPrevious blood markers:\n${pastMarkersSummary}`;
    if (mediaNote) userPrompt += `\nNote: ${mediaNote}`;
    if (cleanedText && !Object.keys(markers).length) userPrompt += `\nExtracted: ${cleanedText}`;
    if (whoop && whoop.user_id) userPrompt += `\nWHOOP profile: ${whoop.first_name} ${whoop.last_name}`;

    let gptResponse = "";
    if (!chartRequested) {
      try {
        gptResponse = await getGPTReply(systemPrompt, userPrompt);
        gptResponse = gptResponse.slice(0, 1600); // Twilio limit
      } catch {
        gptResponse = "Sorry, something went wrong!";
      }
      await sendWhatsApp(gptResponse, From);
    }
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
  // OCR.space API: image or PDF
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

function buildQuickChartUrl(dates, values, marker) {
  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify({
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: `${marker} Trend`,
        data: values
      }]
    }
  }))}`;
}

function getChartRequestMarker(text) {
  const possible = ["LDL", "HDL", "ApoB", "Lp(a)", "VitaminD", "Glucose", "Triglycerides", "Ferritin"];
  for (const marker of possible) {
    if (text && text.toLowerCase().includes(marker.toLowerCase())) return marker.replace(/[^A-Za-z0-9\-]/g,'');
  }
  return null;
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

async function sendWhatsApp(text, to, mediaUrl) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text,
    ...(mediaUrl ? { mediaUrl } : {})
  });
}

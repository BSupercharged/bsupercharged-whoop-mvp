import Twilio from "twilio";
import { parse } from "querystring";
import { OpenAI } from "openai";
import { MongoClient } from "mongodb";
import fetch from "node-fetch";
import pdfParse from "pdf-parse";

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
  let extractedText = "";
  let mediaNote = "";

  // -- OCR Logic for files (images/PDFs) --
  if (NumMedia && Number(NumMedia) > 0) {
    for (let i = 0; i < Number(NumMedia); i++) {
      const mediaType = body[`MediaContentType${i}`];
      const mediaUrl = body[`MediaUrl${i}`];
      if (mediaType === "application/pdf") {
        try {
          // Try as text PDF
          extractedText += await fetchAndParsePDF(mediaUrl);
        } catch (err) {
          // Fallback: OCR as image (scanned PDF)
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

  // --- Extract blood markers (very basic regex for demo, customize for your lab reports) ---
  const markers = {};
  // Example: matches LDL-C: 3.9 or LDL: 3.9 etc
  (extractedText || "").split(/\n/).forEach(line => {
    let m = line.match(/([A-Za-z\(\)\-\+0-9\/ ]{2,15})[: ]+([0-9\.]+)/);
    if (m) markers[m[1].replace(/\s+/g,'').replace(/[^A-Za-z0-9\-]/g,'')] = parseFloat(m[2]);
  });

  // -- MongoDB Setup --
  let mongoClient, user = null;
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
        date: new Date(), // You could parse this from the text if needed
        markers,
        raw_text: extractedText,
        created_at: new Date()
      });
      mediaNote += `Blood results saved: ${Object.keys(markers).join(', ')}.\n`;
    }

    // --- Chart reply if asked for a marker ---
    const chartMarker = getChartRequestMarker(Body);
    if (chartMarker) {
      // Query last 10 readings for this marker
      const lastResults = await bloods.find({ whatsapp: phone, [`markers.${chartMarker}`]: { $exists: true } })
        .sort({ date: -1 })
        .limit(10)
        .toArray();
      if (lastResults.length) {
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

    // WHOOP: Try to use, but not required
    let whoop = null;
    if (user && user.access_token) {
      try {
        whoop = await fetchWhoop("user/profile/basic", user.access_token);
      } catch {}
    }

    // Compose GPT prompt
    let systemPrompt = `You are an advanced health assistant for biohackers. Use all context from blood tests (markers, values, trends), uploaded PDF/image text, and WHOOP metrics (if present). Never dump raw data unless asked for "details".`;
    let userPrompt = `User: "${Body}"\n`;
    if (Object.keys(markers).length) userPrompt += `\nRecent bloods: ${JSON.stringify(markers)}`;
    if (mediaNote) userPrompt += `\nNote: ${mediaNote}`;
    if (whoop && whoop.user_id) userPrompt += `\nWHOOP profile: ${whoop.first_name} ${whoop.last_name}`;

    let gptResponse = "";
    try {
      gptResponse = await getGPTReply(systemPrompt, userPrompt);
      gptResponse = gptResponse.slice(0, 1600);
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
  // User message: "Show me my LDL" or "Plot HDL trend"
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


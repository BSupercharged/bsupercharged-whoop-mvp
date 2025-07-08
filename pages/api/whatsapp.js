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
  let pdfResult = "";
  let mediaMessage = "";

  // --- 1. PDF-only uploads ---
  if (NumMedia && Number(NumMedia) > 0) {
    for (let i = 0; i < Number(NumMedia); i++) {
      const mediaType = body[`MediaContentType${i}`];
      const mediaUrl = body[`MediaUrl${i}`];
      if (mediaType === "application/pdf") {
        try {
          pdfResult += await fetchAndParsePDF(mediaUrl);
        } catch (err) {
          pdfResult += `Could not process the PDF. (${err.message})\n`;
        }
      } else if (mediaType && mediaType.startsWith("image/")) {
        mediaMessage += `Image received, but this assistant can't read images. If you have blood results or similar, please send them as a PDF with selectable text.\n`;
      }
    }
  }

  // --- 2. Load user context ---
  let user, whoop = {};
  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");
    user = await tokens.findOne({ whatsapp: phone });

    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `Hi! Please connect your WHOOP account here: ${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).setHeader("Content-Type", "text/plain").end();
    }

    // Fetch all WHOOP data for the last year
    const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date().toISOString();
    whoop.profile = await fetchWhoop("user/profile/basic", user.access_token);
    whoop.recovery = await fetchWhoop(`recovery?start=${start}&end=${end}`, user.access_token);
    whoop.sleep = await fetchWhoop(`sleep?start=${start}&end=${end}`, user.access_token);
    whoop.workout = await fetchWhoop(`workout?start=${start}&end=${end}`, user.access_token);
    whoop.body = await fetchWhoop(`body?start=${start}&end=${end}`, user.access_token);

    await mongoClient.close();
  } catch (err) {}

  // --- 3. Compose prompt ---
  let systemPrompt = `You are an advanced health assistant for biohackers. Use context from PDFs (if any) and all available WHOOP data (profile, recovery, sleep, workout, body). Never dump raw data unless the user asks for "details" or "raw".`;
  let userPrompt = `User: "${Body}"\n`;

  if (pdfResult) userPrompt += `\nPDF: "${pdfResult.slice(0, 900)}"${pdfResult.length > 900 ? '...' : ''}`;
  if (mediaMessage) userPrompt += `\nNote: ${mediaMessage}`;
  // Only show summaries, not raw arrays
  if (whoop && whoop.profile && whoop.profile.user_id) userPrompt += `\nWHOOP profile: ${whoop.profile.first_name} ${whoop.profile.last_name}.`;
  if (whoop && whoop.recovery && whoop.recovery.records?.length) userPrompt += `\nYou have ${whoop.recovery.records.length} recovery records in the past year.`;
  if (whoop && whoop.sleep && whoop.sleep.records?.length) userPrompt += `\n${whoop.sleep.records.length} sleep records in the past year.`;
  if (whoop && whoop.workout && whoop.workout.records?.length) userPrompt += `\n${whoop.workout.records.length} workouts logged.`;
  if (whoop && whoop.body && whoop.body.records?.length) userPrompt += `\n${whoop.body.records.length} body measurements on file.`;
  // If user asks for details, add a sample
  if (Body && /detail|raw|show|data|json/i.test(Body)) {
    if (whoop.recovery?.records?.length) userPrompt += `\nSample recovery: ${JSON.stringify(whoop.recovery.records[0].score)}`;
    if (whoop.sleep?.records?.length) userPrompt += `\nSample sleep: ${JSON.stringify(whoop.sleep.records[0].score)}`;
    if (whoop.workout?.records?.length) userPrompt += `\nSample workout: ${JSON.stringify(whoop.workout.records[0])}`;
    if (whoop.body?.records?.length) userPrompt += `\nSample body: ${JSON.stringify(whoop.body.records[0])}`;
  }

  // --- 4. GPT reply ---
  let gptResponse;
  try {
    gptResponse = await getGPTReply(systemPrompt, userPrompt);
    gptResponse = gptResponse.slice(0, 1600);
  } catch {
    gptResponse = "Sorry, something went wrong with your question!";
  }
  try { await sendWhatsApp(gptResponse, From); } catch {}
  res.status(200).setHeader("Content-Type", "text/plain").end();
}

// ----- Utility Functions -----

async function fetchWhoop(path, token) {
  const base = "https://api.prod.whoop.com/developer/v1/";
  const url = path.startsWith("http") ? path : base + path;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
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

import Twilio from "twilio";
import { parse } from "querystring";
import { OpenAI } from "openai";
import { MongoClient } from "mongodb";
import fetch from "node-fetch";
import pdfParse from "pdf-parse";
import Tesseract from "tesseract.js";

export const config = {
  api: { bodyParser: false },
};

async function downloadFile(url, authUser, authPass) {
  // Twilio media URLs require basic auth
  const res = await fetch(url, {
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(authUser + ":" + authPass).toString("base64"),
    },
  });
  return Buffer.from(await res.arrayBuffer());
}

async function extractTextFromMedia(url, type, twilioSid, twilioToken) {
  try {
    const file = await downloadFile(url, twilioSid, twilioToken);
    if (type === "application/pdf") {
      const data = await pdfParse(file);
      return data.text ? data.text.trim().slice(0, 2000) : "[No text in PDF]";
    } else if (type.startsWith("image/")) {
      const {
        data: { text },
      } = await Tesseract.recognize(file, "eng");
      return text.trim().slice(0, 2000) || "[No text in image]";
    }
    return "[Unsupported media type]";
  } catch (err) {
    return "[Media extraction failed]";
  }
}

export default async function handler(req, res) {
  let rawBody = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => {
      rawBody += chunk;
    });
    req.on("end", resolve);
  });
  const body = parse(rawBody);

  const { From, Body, NumMedia } = body;
  const phone = (From || "").replace("whatsapp:", "").replace("+", "");

  let mediaText = "";
  if (NumMedia && Number(NumMedia) > 0) {
    for (let i = 0; i < Number(NumMedia); i++) {
      const url = body[`MediaUrl${i}`];
      const type = body[`MediaContentType${i}`];
      mediaText += await extractTextFromMedia(
        url,
        type,
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      mediaText += "\n";
    }
  }

  // Mongo connection
  let user, isNewUser = false;
  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");
    user = await tokens.findOne({ whatsapp: phone });
    isNewUser = !user;
    await mongoClient.close();
  } catch {
    await sendWhatsApp(
      "❗ Database error. Please try again later.",
      From
    );
    return res.status(500).setHeader("Content-Type", "text/plain").end();
  }

  // New user: prompt to connect WHOOP (not handled here)
  if (!user || !user.access_token) {
    const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
    await sendWhatsApp(
      `👋 Please connect your WHOOP:\n👉 ${loginLink}`,
      From
    );
    return res.status(200).setHeader("Content-Type", "text/plain").end();
  }

  // --- 1st Message for User: Analyse yesterday's data
  if (isNewUser || user.last_seen === undefined) {
    // Mark user as not new for next message
    try {
      const mongoClient = new MongoClient(process.env.MONGODB_URI);
      await mongoClient.connect();
      const db = mongoClient.db("whoop_mvp");
      const tokens = db.collection("whoop_tokens");
      await tokens.updateOne({ whatsapp: phone }, { $set: { last_seen: new Date() } });
      await mongoClient.close();
    } catch {}
    // Fetch yesterday's recovery
    let yesterday = "No data";
    try {
      const recovery = await getWhoopRecovery(user.access_token, 1); // 1 = yesterday
      yesterday = JSON.stringify(recovery);
    } catch {
      yesterday = "[No data found]";
    }
    await sendWhatsApp(
      `Analysing your data from yesterday:\n${yesterday}`.slice(0, 1500),
      From
    );
    return res.status(200).setHeader("Content-Type", "text/plain").end();
  }

  // --- Conversational from here (always <=1500 chars)
  let context = `Previous extracted text: ${mediaText}\n`;
  if (user && user.access_token) {
    try {
      const todayRecovery = await getWhoopRecovery(user.access_token, 0); // today
      context += `Today's WHOOP: ${JSON.stringify(todayRecovery)}\n`;
    } catch {}
  }

  const prompt = `
You are a world-class health and longevity assistant for advanced biohackers.
Here is the context from the user's WhatsApp message, WHOOP data, and any uploaded bloodwork (text, PDF, or image OCR):

${context}
User's message: "${Body}"

Please answer in 2-4 sentences. 
- If a blood marker or supplement is detected, explain its relevance.
- If the user sent a PDF/image, summarise any actionable health findings.
- NEVER repeat generic or obvious advice. Be sharp and original.
`;

  let gptReply;
  try {
    gptReply = await getGPTReply(prompt);
  } catch {
    gptReply = "⚡ Sorry, OpenAI is busy. Try again!";
  }

  await sendWhatsApp(gptReply.slice(0, 1500), From);

  res.status(200).setHeader("Content-Type", "text/plain").end();
}

// ---- HELPERS ----

async function getGPTReply(message) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a world-class longevity & health coach for advanced biohackers. Use all available context. Never give generic advice." },
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
    body: text,
  });
}

async function getWhoopRecovery(token, offsetDays = 0) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const from = new Date(now);
  from.setDate(from.getDate() - offsetDays);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);

  const fromIso = from.toISOString().split("T")[0];
  const toIso = to.toISOString().split("T")[0];

  const url = `https://api.prod.whoop.com/developer/v1/recovery?start=${fromIso}&end=${toIso}`;
  const res = await fetch(url, {
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

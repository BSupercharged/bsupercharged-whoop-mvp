// /pages/api/whatsapp.js

import { MongoClient } from "mongodb";
import Twilio from "twilio";
import { parse } from "querystring";
import { OpenAI } from "openai";

// Disable Next.js built-in bodyParser, so we can parse Twilio's webhooks
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  let rawBody = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => { rawBody += chunk; });
    req.on("end", resolve);
  });
  const body = parse(rawBody);

  const { Body, From } = body;
  let debugLog = [];
  debugLog.push(`[WhatsApp] Incoming from: ${From}`);
  debugLog.push(`[WhatsApp] Body: ${Body}`);

  try {
    const phone = (From || "").replace("whatsapp:", "").replace("+", "").trim();
    debugLog.push(`[Extracted phone]: ${phone}`);

    // Connect to MongoDB
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");
    const user = await tokens.findOne({ whatsapp: phone });
    debugLog.push(`[MongoDB] User found? ${!!user}`);

    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `DEBUG:\n${debugLog.join("\n")}\n\n👋 To get started, connect your WHOOP account:\n👉 ${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).send("Login link sent");
    }

    // Use OpenAI for response
    const gptReply = await getGPTReply(Body);
    await sendWhatsApp(
      `DEBUG:\n${debugLog.join("\n")}\n\n${gptReply}`, From
    );
    await mongoClient.close();
    res.status(200).send("Replied with debug + GPT");
  } catch (err) {
    debugLog.push(`[ERROR]: ${err?.message}`);
    try {
      await sendWhatsApp(`DEBUG (error):\n${debugLog.join("\n")}`, From);
    } catch {
      // ignore Twilio fail
    }
    res.status(500).send("Error handled, debug sent");
  }
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text.length > 1500 ? text.slice(0, 1500) : text,
  });
}

async function getGPTReply(userMsg) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are a super-concise, actionable health optimization assistant, replying to a high-performing user who wants quick, scientific, WHOOP-based advice and also mixing in the contextual health data they have provided via whatsapp including pdfs. Use bullet points when possible. No fluff, maximum 100 words per response. Advice can include supplements and food advice. Gloss quickly over the standard stuff.",
      },
      { role: "user", content: userMsg || "" }
    ],
    max_tokens: 250,
  });
  return chat.choices[0]?.message?.content?.trim() || "No reply generated.";
}

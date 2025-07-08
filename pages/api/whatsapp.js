// /pages/api/whatsapp.js

import Twilio from "twilio";
import { parse } from "querystring";

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
  let reply = `👋 Received: "${Body || ""}" from ${From}.`;
  if (NumMedia && Number(NumMedia) > 0) {
    reply += `\nMedia detected: ${NumMedia} file(s).\n`;
    for (let i = 0; i < Number(NumMedia); i++) {
      reply += `Media${i + 1}: ${body[`MediaUrl${i}`]} (type: ${body[`MediaContentType${i}`]})\n`;
      // You can fetch/process this file here if you want!
    }
  }

  try {
    await sendWhatsApp(reply.length > 1600 ? reply.slice(0, 1600) : reply, From);
  } catch (err) {
    // Optionally log the error, but always reply to Twilio!
  }

  // Always send a valid Content-Type and no body to Twilio!
  res.status(200).setHeader("Content-Type", "text/plain").end();
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text,
  });
}

import OpenAI from "openai";
import Twilio from "twilio";

export default async function handler(req, res) {
  const { Body, From } = req.body;

  const responseText = await getGPTReply(Body || "How was my sleep?");
  await sendWhatsApp(responseText, From);
  res.status(200).send("OK");
}

async function getGPTReply(message) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a health coach. Reply concisely based on WHOOP health metrics." },
      { role: "user", content: message }
    ]
  });

  return chat.choices[0].message.content.trim();
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER, // e.g., 'whatsapp:+14155238886'
    to,
    body: text
  });
}

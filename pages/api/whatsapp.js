import Twilio from "twilio";
import { parse } from "querystring";
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  let rawBody = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => { rawBody += chunk; });
    req.on("end", resolve);
  });
  const body = parse(rawBody);

  const { From, Body } = body;
  try {
    if (From) {
      const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: From,
        body: `[Echo] Got: "${Body}" from: ${From}`,
      });
    }
  } catch (e) {
    // Optionally log error, but do nothing else
  }
  // ALWAYS finish with 200 and Content-Type
  res.status(200).setHeader("Content-Type", "text/plain").end();
}

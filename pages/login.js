import Twilio from "twilio";

export default async function handler(req, res) {
  const { From, Body } = req.body;

  // Add your user logic here later
  try {
    const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: From,
      body: `PONG TEST: ${Body}`,
    });
    console.log("Replied to WhatsApp:", From, Body);
  } catch (e) {
    console.error("[Twilio send error]", e);
  }
  res.status(200).send("pong sent");
}

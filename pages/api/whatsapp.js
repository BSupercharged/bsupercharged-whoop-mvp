import { MongoClient } from 'mongodb';
import { OpenAI } from 'openai';
import Twilio from 'twilio';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const { Body, From, NumMedia } = req.body;
  const phone = From.replace("whatsapp:", "");

  // MongoDB
  const mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();
  const db = mongoClient.db("whoop_mvp");
  const tokens = db.collection("whoop_tokens");
  const user = await tokens.findOne({ whatsapp: phone });
  const isNewUser = !user || !user.last_seen;

  // Relogin or login help
  if (
    /relogin|login|connect|auth|authori/i.test(Body || "") ||
    !user || !user.access_token
  ) {
    const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
    await sendWhatsApp(
      `👋 To connect your WHOOP, tap this link: ${loginLink}\nFollow the instructions and return to WhatsApp when done.`,
      From
    );
    await mongoClient.close();
    return res.status(200).end();
  }

  // OCR placeholder for PDF/Media
  if (NumMedia && parseInt(NumMedia) > 0) {
    // TODO: OCR logic for PDF/images here
    await sendWhatsApp(
      "PDF and image analysis will be available soon. Please send a message if you need something specific analyzed.",
      From
    );
    await mongoClient.close();
    return res.status(200).end();
  }

  // On first message (or first of the day), always analyze yesterday's WHOOP recovery
  if (isNewUser || /^(hi|hello|hey|\s*)$/i.test(Body || "")) {
    let replyMsg = "";
    try {
      const recovery = await getWhoopRecovery(user.access_token, 1); // 1 = yesterday
      if (
        recovery &&
        (recovery.recovery_score > 0 ||
          recovery.hrv > 0 ||
          recovery.rhr > 0 ||
          recovery.spo2 > 0)
      ) {
        replyMsg =
          `Analysing your WHOOP recovery for yesterday:\n` +
          `Recovery Score: ${recovery.recovery_score}\n` +
          `HRV: ${recovery.hrv}\n` +
          `RHR: ${recovery.rhr}\n` +
          `SpO2: ${recovery.spo2}\n\n` +
          `Reply with a question to get advanced analysis or discuss trends!`;
      } else {
        replyMsg =
          "No new WHOOP recovery data found for yesterday. Make sure your device is synced in the WHOOP app.";
      }
    } catch (e) {
      replyMsg =
        "Could not retrieve recovery data for yesterday. Please ensure your WHOOP is synced.";
    }
    // Update user last_seen timestamp
    await tokens.updateOne(
      { whatsapp: phone },
      { $set: { last_seen: new Date() } }
    );
    await sendWhatsApp(replyMsg.slice(0, 1500), From);
    await mongoClient.close();
    return res.status(200).end();
  }

  // For any other message, use advanced GPT health coach (with 1500 char limit)
  let contextMsg = "";
  if (user && user.whoop_data) {
    contextMsg += `Latest WHOOP recovery: ${JSON.stringify(user.whoop_data)}\n`;
  }
  // In future, you can add: + blood marker summaries, OCR outputs, etc.

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are an advanced biohacker's AI assistant. Reply concisely and insightfully, using all available WHOOP or bloodwork metrics, and any OCR/PDF context if available. Skip explanations about basic health topics unless requested. All replies must be under 1500 characters.",
      },
      { role: "user", content: `${contextMsg}User: ${Body}` }
    ]
  });
  await sendWhatsApp(chat.choices[0].message.content.slice(0, 1500), From);

  // Update last_seen
  await tokens.updateOne(
    { whatsapp: phone },
    { $set: { last_seen: new Date() } }
  );
  await mongoClient.close();
  res.status(200).end();
}

// ---- HELPERS ----

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text,
  });
}

// Gets yesterday’s recovery (or latest if yesterday not found)
async function getWhoopRecovery(token, daysAgo = 1) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - daysAgo + 1);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 1);

  const url = `https://api.prod.whoop.com/developer/v1/recovery?start=${start.toISOString()}&end=${end.toISOString()}&limit=1`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
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

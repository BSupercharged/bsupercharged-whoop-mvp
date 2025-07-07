import axios from "axios";
import { OpenAI } from "openai";
import { MongoClient } from "mongodb";
import Twilio from "twilio";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  const { From, Body, NumMedia, MediaUrl0, MediaContentType0 } = req.body;

  // Twilio client
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db("whoop_mvp");

  try {
    // 📎 Handle media uploads (e.g. PDF or JPG bloodwork)
    if (NumMedia && parseInt(NumMedia) > 0) {
      const mediaRes = await axios.get(MediaUrl0, {
        responseType: "arraybuffer",
        auth: {
          username: process.env.TWILIO_ACCOUNT_SID,
          password: process.env.TWILIO_AUTH_TOKEN
        }
      });

      const base64Data = Buffer.from(mediaRes.data).toString("base64");

      await db.collection("health_uploads").insertOne({
        from: From,
        contentType: MediaContentType0,
        uploadedAt: new Date(),
        data: base64Data
      });

      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: From,
        body: "✅ Thanks! Your file has been saved and will be used to personalize your health insights."
      });

      return res.status(200).send("Media received");
    }

    // 🔐 Retrieve latest WHOOP token for user
    const tokenDoc = await db.collection("whoop_tokens").findOne({ from: From }, { sort: { _id: -1 } });

    if (!tokenDoc?.access_token) {
      const loginUrl = `https://bsupercharged-whoop-mvp.vercel.app/api/login?phone=${encodeURIComponent(From)}`;
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: From,
        body: `🚪 Please log in to WHOOP here to continue: ${loginUrl}`
      });
      return res.status(200).send("Login prompted");
    }

    // 📊 Fetch latest recovery (or extend to sleep, workout etc.)
    const whoopRes = await axios.get("https://api.prod.whoop.com/developer/v1/recovery", {
      headers: {
        Authorization: `Bearer ${tokenDoc.access_token}`
      }
    });

    const recovery = whoopRes.data?.records?.[0]?.score || null;

    // 🧪 Get recent uploaded health PDF summaries if any
    const latestPdf = await db.collection("health_uploads").findOne(
      { from: From },
      { sort: { uploadedAt: -1 } }
    );

    let bloodworkNote = "";
    if (latestPdf) {
      bloodworkNote = "The user has uploaded a health file that may contain bloodwork results. Consider this in your response.";
    }

    // 🧠 GPT reply
    const chat = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a health coach. Personalize your reply based on WHOOP recovery data (recovery score: ${recovery?.recovery_score}, HRV: ${recovery?.hrv_rmssd_milli}, RHR: ${recovery?.resting_heart_rate}, SpO2: ${recovery?.spo2_percentage}) and uploaded health info. ${bloodworkNote}`
        },
        { role: "user", content: Body || "How was my recovery?" }
      ]
    });

    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: From,
      body: chat.choices?.[0]?.message?.content || "Something went wrong processing your message."
    });

    res.status(200).send("Message sent");

  } catch (err) {
    console.error("Error in WhatsApp handler:", err.message);
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: From,
      body: `⚠️ Something went wrong. ${err.response?.data?.error || err.message}`
    });
    res.status(500).json({ error: err.message });
  } finally {
    await mongo.close();
  }
}

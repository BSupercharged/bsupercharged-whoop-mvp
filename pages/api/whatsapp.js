import { MongoClient } from 'mongodb';
import { OpenAI } from 'openai';
import Twilio from 'twilio';
import fetch from 'node-fetch';

// In-memory conversation history for demo purposes (for production, use persistent store)
const userMemory = {};

export default async function handler(req, res) {
  try {
    const { Body, From } = req.body;
    const phone = (From.replace('whatsapp:', '') || '').replace(/^\+/, '').trim();

    // Set up MongoDB connection
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");
    const files = db.collection("user_files"); // assuming files are stored here

    // Check for user and their WHOOP token
    const user = await tokens.findOne({ whatsapp: phone });
    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `👋 Hi! To give you the best insights from your data, please connect your WHOOP account here:\n👉 ${loginLink}\n\nIf you've already connected but see this message, tap the link again to refresh your connection.`, From
      );
      await mongoClient.close();
      return res.status(200).send("Login link sent");
    }

    // Retrieve latest WHOOP data
    let recovery;
    try {
      recovery = await getLatestWhoopRecovery(user.access_token);
      if (!recovery || !recovery.recovery_score) throw new Error("No data");
    } catch (err) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `🔒 Your WHOOP login has expired or no data is available. Please reconnect here:\n👉 ${loginLink}\n\nThis keeps your health assistant up-to-date!`,
        From
      );
      await mongoClient.close();
      return res.status(200).send("Login required");
    }

    // Check if we have health files/bloodwork stored for this user
    const fileDoc = await files.findOne({ whatsapp: phone });
    const bloodworkSummary = fileDoc?.summary || null; // or store actual values in your pipeline

    // Use a memory so we don't repeat the same stats in every reply
    const lastSummary = userMemory[phone]?.lastSummary || "";
    let firstMsg = false;
    let intro = "";

    if (!userMemory[phone]) {
      firstMsg = true;
      userMemory[phone] = {};
      intro = "Analysing your data from yesterday:\n";
    }

    // Compose the context for OpenAI
    let context = "";
    if (firstMsg) {
      context += `Wearable: WHOOP recovery score ${recovery.recovery_score}, HRV ${recovery.hrv}, RHR ${recovery.rhr}, SpO2 ${recovery.spo2}.`;
      if (bloodworkSummary) {
        context += ` Bloodwork: ${bloodworkSummary}`;
      }
    } else {
      // Summarise context but don't repeat metrics
      context += "Refer to the user's wearable and blood test data already on file. Don't repeat metrics unless relevant.";
    }
    // If no files, prompt politely
    if (firstMsg && !bloodworkSummary) {
      intro += "No bloodwork files found. You can upload PDF or photo files of your lab results to get deeper insights.";
    }

    // Construct the GPT prompt
    const gptPrompt = [
      { role: "system", content: 
        "You are a highly advanced health assistant for a biohacker who values actionable, science-backed insights. You have access to their wearable (WHOOP) and blood test data and can reference them, but avoid repeating the same values unless specifically relevant. Always be conversational and helpful, and reference uploaded files if available. If asked about data you don't have, remind the user they can upload lab PDFs or photos at any time. Keep replies concise, high-value, and under 1500 characters."
      },
      { role: "user", content: `${context}\n\n${Body}` }
    ];

    // Save latest context to user memory for future use
    userMemory[phone].lastSummary = context;

    // Get reply from OpenAI
    const reply = await getGPTReply(gptPrompt);

    await sendWhatsApp(`${intro}${reply}`, From);
    await mongoClient.close();
    res.status(200).send("Response sent");
  } catch (err) {
    console.error("Error in WhatsApp handler:", err);
    res.status(500).send("Internal error");
  }
}

async function getGPTReply(messages) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    max_tokens: 800 // ~1500 chars
  });
  return chat.choices[0].message.content.trim().slice(0, 1500);
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text,
  });
}

async function getLatestWhoopRecovery(token) {
  const res = await fetch("https://api.prod.whoop.com/developer/v1/recovery", {
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

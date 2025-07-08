import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import Twilio from "twilio";
import fetch from "node-fetch";

export default async function handler(req, res) {
  let mongoClient;
  try {
    const { Body, From } = req.body;
    // Extract digits only (matching your saved key)
    const phone = From.replace(/\D/g, '');

    console.log("[WhatsApp] Incoming from:", From, "Digits:", phone);
    console.log("[WhatsApp] Body:", Body);

    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");

    // Find user by digits-only phone
    let user = await tokens.findOne({ whatsapp: phone });
    console.log("[MongoDB] User found?", !!user);

    if (!user || !user.access_token) {
      const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
      await sendWhatsApp(
        `👋 To get started, connect your WHOOP account:\n👉 ${loginLink}`,
        From
      );
      await mongoClient.close();
      return res.status(200).send("Login link sent");
    }

    // Fetch recovery from WHOOP, refresh token if needed
    let recovery;
    try {
      recovery = await getLatestWhoopRecovery(user.access_token);
    } catch (err) {
      if (err.message && err.message.includes("401")) {
        // Try refresh
        if (user.refresh_token) {
          try {
            const newTokens = await refreshWhoopToken(user.refresh_token);
            await tokens.updateOne(
              { whatsapp: phone },
              { $set: { ...newTokens, updated_at: new Date() } }
            );
            user = { ...user, ...newTokens }; // update in-memory user object
            recovery = await getLatestWhoopRecovery(newTokens.access_token);
          } catch (refreshErr) {
            // Refresh failed, prompt login
            const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
            await sendWhatsApp(
              `🔑 Your WHOOP session expired. Please log in again:\n${loginLink}`,
              From
            );
            await mongoClient.close();
            return res.status(200).send("Login link sent after refresh failed");
          }
        } else {
          // No refresh token, prompt login
          const loginLink = `${process.env.BASE_URL}/api/login?whatsapp=${phone}`;
          await sendWhatsApp(
            `🔑 Your WHOOP session expired. Please log in again:\n${loginLink}`,
            From
          );
          await mongoClient.close();
          return res.status(200).send("Login link sent after no refresh");
        }
      } else {
        throw err; // Other errors, rethrow
      }
    }

    // Ask OpenAI for advice based on the metrics
    const message = await getGPTReply(
      `My recovery score is ${recovery.recovery_score}, HRV is ${recovery.hrv}, RHR is ${recovery.rhr}, SpO2 is ${recovery.spo2}. What does this mean and what should I do today?`
    );

    await sendWhatsApp(message, From);
    await mongoClient.close();
    res.status(200).send("Response sent");
  } catch (err) {
    console.error("Error in WhatsApp handler:", err);
    if (mongoClient) await mongoClient.close();
    res.status(500).send("Internal error");
  }
}

async function getGPTReply(message) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chat = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful health assistant. Interpret WHOOP metrics concisely and give recommendations.",
      },
      { role: "user", content: message },
    ],
  });
  // Truncate if message is too long for WhatsApp/Twilio (max 1600 chars)
  return chat.choices[0].message.content.trim().slice(0, 1500);
}

async function sendWhatsApp(text, to) {
  const client = Twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
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

async function refreshWhoopToken(refresh_token) {
  const client_id = process.env.WHOOP_CLIENT_ID;
  const client_secret = process.env.WHOOP_CLIENT_SECRET;
  const redirect_uri = process.env.WHOOP_REDIRECT_URI;
  const res = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      client_id,
      client_secret,
      redirect_uri
    }).toString()
  });
  if (!res.ok) throw new Error(`WHOOP token refresh failed: ${res.status} - ${await res.text()}`);
  return await res.json();
}

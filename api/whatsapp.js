import { MongoClient } from "mongodb";
import Twilio from "twilio";

export default async function handler(req, res) {
  const { Body, From } = req.body;

  try {
    const userPhone = From;

    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("whoop_mvp");
    const tokens = db.collection("whoop_tokens");

    const userToken = await tokens.findOne({ phone: userPhone });
    if (!userToken || !userToken.access_token) {
      await mongoClient.close();
      return res.status(401).json({ success: false, error: "WHOOP access token not found for this number." });
    }

    const response = await fetch("https://api.prod.whoop.com/developer/v1/recovery", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userToken.access_token}`,
        Accept: "application/json"
      }
    });

    const data = await response.json();

    if (!data.records || !data.records.length) {
      await mongoClient.close();
      return res.status(404).json({ success: false, error: "No recovery data found." });
    }

    const latest = data.records[0].score;
    const reply = generateRecoveryAdvice(latest);
    await mongoClient.close();

    await sendWhatsApp(reply, userPhone);
    res.status(200).send("OK");
  } catch (err) {
    console.error("Error in WhatsApp handler:", err.message);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
}

function generateRecoveryAdvice(score) {
  const { recovery_score, resting_heart_rate, hrv_rmssd_milli, skin_temp_celsius, spo2_percentage } = score;

  let insights = `📊 *Recovery Summary*\n`;
  insights += `• Recovery Score: ${recovery_score}/100\n`;
  insights += `• Resting HR: ${resting_heart_rate} bpm\n`;
  insights += `• HRV: ${Math.round(hrv_rmssd_milli)} ms\n`;
  insights += `• Skin Temp: ${skin_temp_celsius.toFixed(1)}°C\n`;
  insights += `• SpO₂: ${spo2_percentage.toFixed(1)}%\n\n`;

  let advice = `🛌 *Sleep & Recovery Tips*\n`;

  if (recovery_score < 60) {
    advice += `• Try 300mg magnesium glycinate from Bonowellness before bed\n`;
    advice += `• Wind down 1h before sleep (no screens, dim lights)\n`;
  }

  if (hrv_rmssd_milli < 60) {
    advice += `• Box breathing: 4-4-4-4 (inhale-hold-exhale-hold)\n`;
    advice += `• Limit alcohol & processed food after 6pm\n`;
  }

  if (resting_heart_rate > 50) {
    advice += `• Avoid heavy meals late\n• Stay hydrated during the day\n`;
  }

  return insights + advice;
}

async function sendWhatsApp(text, to) {
  const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text
  });
}

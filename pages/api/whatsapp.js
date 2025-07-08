export const config = {
  api: { bodyParser: false },
};

import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import Twilio from "twilio";
import fetch from "node-fetch";
import { parse } from "querystring";

async function parseFormBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      try {
        const parsed = parse(data);
        console.log("[DEBUG] Raw form body:", data);
        console.log("[DEBUG] Parsed form body:", parsed);
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  let Body, From;
  try {
    if (req.method === "POST") {
      const form = await parseFormBody(req);
      Body = form.Body;
      From = form.From;
    } else {
      Body = req.body?.Body;
      From = req.body?.From;
    }

    console.log("[DEBUG] Method:", req.method);
    console.log("[DEBUG] Body:", Body);
    console.log("[DEBUG] From:", From);

    if (!Body || !From) {
      // Respond 200 so Twilio doesn't error, but log problem
      console.error("[ERROR] Missing Body or From in request");
      return res.status(200).send("Missing data");
    }

    // ... (rest of your existing logic)

    // For now, just echo back for debugging
    res.status(200).send("Received: " + Body);
  } catch (err) {
    console.error("[ERROR] WhatsApp handler crashed:", err);
    res.status(200).send("Error");
  }
}

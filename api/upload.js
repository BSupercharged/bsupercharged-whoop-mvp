// api/upload.js
import formidable from "formidable";
import fs from "fs";
import { MongoClient } from "mongodb";
import { createWorker } from "tesseract.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const form = new formidable.IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "Upload error" });

    let mongo;
    try {
      const file = files.file[0];
      const phone = fields.phone?.[0] || "unknown";
      const fileBuffer = fs.readFileSync(file.filepath);

      // Save original PDF as base64 in MongoDB
      mongo = new MongoClient(process.env.MONGODB_URI);
      await mongo.connect();
      const db = mongo.db("whoop_mvp");

      // OCR parsing
      const worker = await createWorker();
      await worker.loadLanguage("eng");
      await worker.initialize("eng");
      const {
        data: { text },
      } = await worker.recognize(fileBuffer);
      await worker.terminate();

      await db.collection("health_uploads").insertOne({
        from: phone,
        uploadedAt: new Date(),
        filename: file.originalFilename,
        contentType: file.mimetype,
        textContent: text,
        base64: fileBuffer.toString("base64"),
      });

      return res.status(200).json({ success: true, message: "File uploaded and parsed", preview: text.slice(0, 500) });
    } catch (e) {
      return res.status(500).json({ error: "Processing error", message: e.message });
    } finally {
      if (mongo) await mongo.close();
    }
  });
}

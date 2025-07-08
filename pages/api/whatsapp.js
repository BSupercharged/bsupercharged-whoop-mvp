export default async function handler(req, res) {
  console.log("WhatsApp webhook called!", req.body);
  // Send a simple text reply
  res.setHeader('Content-Type', 'text/plain');
  res.status(200).send("👋 WhatsApp webhook reached Vercel!");
}

BSupercharged WHOOP WhatsApp MVP - Setup Guide

1. Copy all files into your Next.js (Vercel) project as shown.
2. Set environment variables in Vercel:
   - MONGODB_URI
   - WHOOP_CLIENT_ID
   - WHOOP_CLIENT_SECRET
   - WHOOP_REDIRECT_URI (should be https://<your-vercel-domain>/api/callback)
   - OPENAI_API_KEY
   - TWILIO_ACCOUNT_SID
   - TWILIO_AUTH_TOKEN
   - TWILIO_WHATSAPP_NUMBER (e.g. "whatsapp:+31610451196")
   - BASE_URL (e.g. https://bsupercharged-whoop-mvp.vercel.app)
3. Point your Twilio WhatsApp webhook to https://<your-vercel-domain>/api/whatsapp
4. Test by sending a message to your Twilio WhatsApp number.
5. Login with WHOOP when prompted.

Media files will be detected and URLs included in WhatsApp replies (fetch/download logic can be added).

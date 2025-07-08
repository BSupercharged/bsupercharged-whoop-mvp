import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const code = req.query.code;
  const user = req.query.state; // state is now just the phone number

  console.log('[CALLBACK] code:', code);
  console.log('[CALLBACK] user (from state):', user);

  if (!code || !user) {
    return res.status(400).json({
      error: "Missing code or user (phone) number",
      debug: { code, user, state: req.query.state }
    });
  }

  // ...rest of your code unchanged...
}

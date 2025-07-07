// lib/db.js
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable');
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

export async function connectToDatabase() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }).then((mongoose) => {
      return mongoose;
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  whoopAccessToken: { type: String },
  whoopRefreshToken: { type: String },
  whoopTokenExpiresAt: { type: Date }
}, { timestamps: true });

export const User = mongoose.models.User || mongoose.model('User', userSchema);

export async function storeTokenForUser(phone, tokenResponse) {
  await connectToDatabase();

  const { access_token, refresh_token, expires_in } = tokenResponse;

  const user = await User.findOneAndUpdate(
    { phone },
    {
      whoopAccessToken: access_token,
      whoopRefreshToken: refresh_token,
      whoopTokenExpiresAt: new Date(Date.now() + expires_in * 1000),
    },
    { upsert: true, new: true }
  );

  return user;
}

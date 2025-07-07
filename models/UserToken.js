import mongoose from 'mongoose';

const UserTokenSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, unique: true },
  accessToken: { type: String, required: true },
  scope: { type: String },
  tokenType: { type: String },
  expiresIn: { type: Number },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.UserToken || mongoose.model('UserToken', UserTokenSchema);

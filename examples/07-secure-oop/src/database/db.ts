import mongoose from 'mongoose'
import { registerDatabase } from 'exisjs/database'
import { env } from '@/config/env'

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  role: { type: String, default: 'user' },
  passwordHash: { type: String, required: true },
})
const noteSchema = new mongoose.Schema({
  ownerId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
})
const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
})

export const User = mongoose.model('OopUser', userSchema)
export const Note = mongoose.model('OopNote', noteSchema)
export const Session = mongoose.model('OopSession', sessionSchema)

registerDatabase({
  name: 'mongodb',
  connect: async () => {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 3000,
    })
    await User.init()
  },
  disconnect: () => mongoose.disconnect(),
  isHealthy: () => mongoose.connection.readyState === 1,
})

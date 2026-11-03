import { MongoClient, type Collection, type ObjectId } from 'mongodb'
import { registerDatabase } from 'exisjs/database'
import { env } from '@/config/env'

export interface UserDoc {
  _id?: ObjectId
  email: string
  name: string
  role: string
  passwordHash: string
}
export interface NoteDoc {
  _id?: ObjectId
  ownerId: string
  title: string
  body: string
}
export interface SessionDoc {
  tokenHash: string
  userId: string
  expiresAt: Date
}

const client = new MongoClient(env.MONGODB_URI, {
  serverSelectionTimeoutMS: 3000,
})
const db = client.db()

export const users: Collection<UserDoc> = db.collection('func_users')
export const notes: Collection<NoteDoc> = db.collection('func_notes')
export const sessions: Collection<SessionDoc> = db.collection('func_sessions')

registerDatabase({
  name: 'mongodb',
  connect: async () => {
    await client.connect()
    await users.createIndex({ email: 1 }, { unique: true })
    await sessions.createIndex({ tokenHash: 1 }, { unique: true })
    await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  },
  disconnect: () => client.close(),
  isHealthy: async () => (await db.command({ ping: 1 })).ok === 1,
})

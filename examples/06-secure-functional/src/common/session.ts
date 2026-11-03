import { createHash, randomBytes } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { sessions, users } from '@/database/db'

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex')

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await sessions.insertOne({
    tokenHash: hash(token),
    userId,
    expiresAt: new Date(Date.now() + 3600_000),
  })
  return token
}

export async function revokeSession(token: string): Promise<void> {
  await sessions.deleteOne({ tokenHash: hash(token) })
}

export async function loadUser(token: string) {
  const session = await sessions.findOne({
    tokenHash: hash(token),
    expiresAt: { $gt: new Date() },
  })
  if (!session) return undefined
  const user = await users.findOne({ _id: new ObjectId(session.userId) })
  if (!user) return undefined
  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name,
    roles: [user.role],
  }
}

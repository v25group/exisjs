import { createHash, randomBytes } from 'node:crypto'
import { Session, User } from '@/database/db'

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex')

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await Session.create({
    tokenHash: hash(token),
    userId,
    expiresAt: new Date(Date.now() + 3600_000),
  })
  return token
}

export async function revokeSession(token: string): Promise<void> {
  await Session.deleteOne({ tokenHash: hash(token) })
}

export async function loadUser(token: string) {
  const session = await Session.findOne({
    tokenHash: hash(token),
    expiresAt: { $gt: new Date() },
  }).lean()
  if (!session) return undefined
  const user = await User.findById(session.userId).lean()
  if (!user) return undefined
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    roles: [user.role as string],
  }
}

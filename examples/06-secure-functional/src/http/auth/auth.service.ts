import { HttpError } from 'exisjs/error'
import { DUMMY_HASH, hashPassword, verifyPassword } from '@/common/password'
import { users } from '@/database/db'
import { createSession } from '@/common/session'

export async function register(input: {
  email: string
  name: string
  password: string
}) {
  const { password, ...profile } = input
  try {
    const doc = {
      role: 'user',
      ...profile,
      passwordHash: await hashPassword(password),
    }
    const { insertedId } = await users.insertOne(doc)
    return { id: insertedId.toHexString(), email: doc.email, role: doc.role }
  } catch (err: any) {
    if (err?.code === 11000) {
      throw HttpError.conflict('Email is already registered', {
        code: 'EMAIL_TAKEN',
      })
    }
    throw err
  }
}

export async function login(email: string, password: string) {
  const user = await users.findOne({ email })
  const valid = await verifyPassword(
    password,
    user?.passwordHash ?? DUMMY_HASH
  )
  if (!user || !valid) throw HttpError.unauthorized('Wrong email or password')
  return createSession(user._id.toHexString())
}

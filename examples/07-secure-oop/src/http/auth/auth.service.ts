import { HttpError } from 'exisjs/error'
import { DUMMY_HASH, hashPassword, verifyPassword } from '@/common/password'
import { createSession } from '@/common/session'
import { User } from '@/database/db'

export async function register(input: {
  email: string
  name: string
  password: string
}) {
  const { password, ...profile } = input
  try {
    const user = await User.create({
      role: 'user',
      ...profile,
      passwordHash: await hashPassword(password),
    })
    return { id: String(user._id), email: user.email, role: user.role }
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
  const user = await User.findOne({ email }).lean()
  const valid = await verifyPassword(
    password,
    user?.passwordHash ?? DUMMY_HASH
  )
  if (!user || !valid) throw HttpError.unauthorized('Wrong email or password')
  return createSession(String(user._id))
}

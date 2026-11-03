import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const run = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  length: number
) => Promise<Buffer>

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await run(password, salt, 32)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  const actual = await run(password, Buffer.from(salt, 'hex'), 32)
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'))
}

// Compared when the account doesn't exist, so timing doesn't reveal which do
export const DUMMY_HASH = await hashPassword('no-account-has-this-password')

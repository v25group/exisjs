import { createHmac, timingSafeEqual } from 'node:crypto'
import { HttpError } from '../utils/errors'

export interface JWTOptions {
  expiresIn?: number // Seconds
}

function base64url(str: string | Buffer): string {
  const base64 = Buffer.isBuffer(str)
    ? str.toString('base64')
    : Buffer.from(str).toString('base64')

  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function fromBase64url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf8')
}

/**
 * Sign a payload to create a JWT token.
 * @param payload Object to encode
 * @param secret The signing secret
 * @param options JWTOptions (e.g. expiresIn)
 */
export function signJWT(
  payload: Record<string, unknown>,
  secret: string,
  options?: JWTOptions
): string {
  const header = { alg: 'HS256', typ: 'JWT' }

  const expPayload = { ...payload }
  if (options?.expiresIn) {
    expPayload.exp = Math.floor(Date.now() / 1000) + options.expiresIn
  }

  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(expPayload))

  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest()

  return `${encodedHeader}.${encodedPayload}.${base64url(signature)}`
}

export class TokenExpiredError extends HttpError {
  constructor(message = 'Token expired') {
    super(message, 401, 'TOKEN_EXPIRED')
    this.name = 'TokenExpiredError'
  }
}

/**
 * Verify a JWT token and extract its payload.
 * Throws HttpError(401) if the token is invalid or TokenExpiredError if expired.
 */
export function verifyJWT<T = unknown>(token: string, secret: string): T {
  if (!token || typeof token !== 'string') {
    throw HttpError.unauthorized('Invalid token format')
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    throw HttpError.unauthorized('Invalid token format')
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts

  const expectedSignature = base64url(
    createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest()
  )

  const expectedBuf = Buffer.from(expectedSignature)
  const actualBuf = Buffer.from(encodedSignature)

  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    throw HttpError.unauthorized('Invalid token signature')
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(fromBase64url(encodedPayload))
  } catch {
    throw HttpError.unauthorized('Malformed token payload')
  }

  if (
    typeof payload.exp === 'number' &&
    Math.floor(Date.now() / 1000) > payload.exp
  ) {
    throw new TokenExpiredError()
  }

  return payload as T
}

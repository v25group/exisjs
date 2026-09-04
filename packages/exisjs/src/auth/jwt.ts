import { HttpError } from '../error/errors'
import { signJwt, verifyJwt } from '@exisjs/rs'

export interface JWTOptions {
  expiresIn?: number // Seconds
}

/**
 * Sign a payload to create a JWT token.
 * @param payload Object to encode
 * @param secret The signing secret
 * @param options JWTOptions (e.g. expiresIn)
 */
export function signJWT(
  payload: Record<string, unknown>,
  secret: string | string[],
  options?: JWTOptions
): string {
  const actualSecret = Array.isArray(secret) ? secret[0] : secret

  try {
    return signJwt(payload, actualSecret, options?.expiresIn)
  } catch (err: any) {
    throw new Error(`Failed to sign JWT: ${err.message}`, { cause: err })
  }
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
export function verifyJWT<T = unknown>(
  token: string,
  secret: string | string[]
): T {
  if (!token || typeof token !== 'string') {
    throw HttpError.unauthorized('Invalid token format')
  }

  const secrets = Array.isArray(secret) ? secret : [secret]

  try {
    return verifyJwt(token, secrets) as T
  } catch (err: any) {
    if (err.message.includes('TokenExpiredError')) {
      throw new TokenExpiredError()
    }

    // Check specific N-API error messages mapped to HTTP 401
    const unauthMsg = [
      'Invalid token',
      'Malformed token',
      'HMAC error',
      'Invalid base64url',
    ]
    if (unauthMsg.some((m) => err.message.includes(m))) {
      throw HttpError.unauthorized(err.message)
    }

    throw HttpError.unauthorized('Invalid token signature')
  }
}

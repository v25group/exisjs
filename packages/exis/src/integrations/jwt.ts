import { signJWT, verifyJWT, type JWTOptions } from '../auth/jwt'

export const jwt = {
  /**
   * Automatically signs a JWT token using `process.env.JWT_SECRET`.
   */
  sign(payload: Record<string, unknown>, options?: JWTOptions): string {
    const secret = process.env.JWT_SECRET
    if (!secret) {
      throw new Error('process.env.JWT_SECRET is missing')
    }
    const secrets = secret.split(',').map((s) => s.trim())
    return signJWT(payload, secrets, options)
  },

  /**
   * Automatically verifies a JWT token using `process.env.JWT_SECRET`.
   */
  verify<T = unknown>(token: string): T {
    const secret = process.env.JWT_SECRET
    if (!secret) {
      throw new Error('process.env.JWT_SECRET is missing')
    }
    const secrets = secret.split(',').map((s) => s.trim())
    return verifyJWT<T>(token, secrets)
  },
}

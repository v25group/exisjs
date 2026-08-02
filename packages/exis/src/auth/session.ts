import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from '../types'

export type SessionData = Record<string, unknown>

export interface SessionStore {
  get(sessionId: string): Promise<SessionData | null> | SessionData | null
  set(sessionId: string, data: SessionData, ttl?: number): Promise<void> | void
  destroy(sessionId: string): Promise<void> | void
}

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, { data: SessionData; expiresAt: number }>()

  get(sessionId: string): SessionData | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId)
      return null
    }
    return session.data
  }

  set(sessionId: string, data: SessionData, ttl: number = 86400 * 1000): void {
    this.sessions.set(sessionId, {
      data,
      expiresAt: Date.now() + ttl,
    })
  }

  destroy(sessionId: string): void {
    this.sessions.delete(sessionId)
  }
}

export interface SessionOptions {
  secret: string
  store?: SessionStore
  cookieName?: string
  ttl?: number // milliseconds, default 1 day
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

function signCookie(val: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(val).digest('base64url')
  return `${val}.${signature}`
}

function unsignCookie(val: string, secret: string): string | false {
  const parts = val.split('.')
  if (parts.length !== 2) return false
  const [str, signature] = parts
  const expectedSignature = createHmac('sha256', secret)
    .update(str)
    .digest('base64url')

  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expectedSignature)

  if (sigBuf.length !== expectedBuf.length) return false
  if (!timingSafeEqual(sigBuf, expectedBuf)) return false
  return str
}

export function session(options: SessionOptions) {
  if (!options.secret || options.secret.length < 32) {
    throw new Error(
      'session options.secret must be at least 32 characters long'
    )
  }

  const store = options.store || new MemorySessionStore()
  const cookieName = options.cookieName || 'exis_sid'
  const ttl = options.ttl || 86400 * 1000 // 1 day

  return async (req: Request, res: Response, next: NextFunction) => {
    let sessionId: string | undefined

    // 1. Try to get session ID from cookie
    const cookieVal = req.cookies?.[cookieName]
    if (cookieVal) {
      const unsigned = unsignCookie(cookieVal, options.secret)
      if (unsigned) {
        sessionId = unsigned
      }
    }

    // 2. Load session data or create new
    let sessionData: SessionData = {}
    if (sessionId) {
      const data = await store.get(sessionId)
      if (data) {
        sessionData = data
      } else {
        sessionId = undefined // Invalid or expired
      }
    }

    if (!sessionId) {
      sessionId = randomBytes(24).toString('base64url')
      // Only set cookie if we created a new session ID
      res.cookie(cookieName, signCookie(sessionId, options.secret), {
        maxAge: ttl / 1000,
        httpOnly: true,
        secure: options.secure ?? process.env.NODE_ENV === 'production',
        sameSite: options.sameSite ?? 'Lax',
        path: '/',
      })
    }

    // 3. Attach session to request
    req.session = sessionData

    const initialState = JSON.stringify(sessionData)

    // 4. Hook into res.raw.end to save the session automatically
    const originalEnd = res.raw.end.bind(res.raw)
    res.raw.end = function (...args: unknown[]) {
      if (JSON.stringify(sessionData) !== initialState) {
        store.set(sessionId as string, sessionData, ttl)
      }
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      return originalEnd(...args)
    }

    next()
  }
}

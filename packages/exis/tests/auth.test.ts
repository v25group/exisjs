import { hashPassword, verifyPassword } from '../src/auth/password'
import { signJWT, verifyJWT } from '../src/auth/jwt'
import { requireRole } from '../src/auth/rbac'
import { MemorySessionStore, session } from '../src/auth/session'
import { App } from '../src/server/app'
import { createTestApp } from '../src/testing/client'
import type { Request, Response } from '../src/types'
import { describe, expect, it } from '../src/testing'

describe('Auth Module', () => {
  describe('Password Hashing (Native)', () => {
    it('hashes a password and verifies it successfully', async () => {
      const password = 'my-super-secret-password'
      const hash = await hashPassword(password)

      expect(hash).toContain(':') // should have salt:hash format

      const isValid = await verifyPassword(password, hash)
      expect(isValid).toBe(true)
    })

    it('rejects an incorrect password', async () => {
      const hash = await hashPassword('correct-password')
      const isValid = await verifyPassword('wrong-password', hash)
      expect(isValid).toBe(false)
    })
  })

  describe('JWT Utilities', () => {
    const secret = 'my-256-bit-secret'
    const payload = { userId: 123, role: 'admin' }

    it('signs and verifies a valid token', () => {
      const token = signJWT(payload, secret)
      const decoded = verifyJWT<{ userId: number; role: string }>(token, secret)

      expect(decoded.userId).toBe(123)
      expect(decoded.role).toBe('admin')
    })

    it('throws error for invalid signature', () => {
      const token = signJWT(payload, secret)
      expect(() => {
        verifyJWT(token, 'wrong-secret')
      }).toThrow('Invalid token signature')
    })

    it('throws error for expired tokens', () => {
      const token = signJWT(payload, secret, { expiresIn: -10 }) // expired 10 seconds ago
      expect(() => {
        verifyJWT(token, secret)
      }).toThrow('Token expired')
    })
  })

  describe('RBAC Middleware', () => {
    it('allows access if user has required role', async () => {
      const app = new App()

      app.use((req: Request, res: Response, next: any) => {
        req.user = { id: 1, role: 'admin' }
        next()
      })

      app.get('/admin', requireRole('admin'), (req, res) => {
        res.status(200).send('Welcome admin')
      })

      await createTestApp(app).get('/admin').expect(200).expect('Welcome admin')
    })

    it('blocks access if user lacks required role', async () => {
      const app = new App()

      app.use((req: Request, res: Response, next: any) => {
        req.user = { id: 1, role: 'user' }
        next()
      })

      app.get('/admin', requireRole('admin'), (req, res) => {
        res.status(200).send('Welcome admin')
      })

      // We expect 403 Forbidden because error handler catches HttpError
      await createTestApp(app).get('/admin').expect(403)
    })
  })

  describe('Session Store', () => {
    it('sets session cookie and stores data', async () => {
      const app = new App()
      const store = new MemorySessionStore()

      app.use(
        session({ secret: 'very-secret-key-at-least-32-chars-long', store })
      )

      app.post('/login', (req: any, res) => {
        req.session.userId = 456
        res.status(200).send('Logged in')
      })

      app.get('/profile', (req: any, res) => {
        if (!req.session.userId) return res.status(401).send('Unauthorized')
        res.status(200).send(`User ID: ${req.session.userId}`)
      })

      const loginRes = await createTestApp(app)
        .post('/login')
        .expect(200)
        .expect('Logged in')

      const cookie = loginRes.headers['set-cookie']

      let cookieStr = ''
      if (Array.isArray(cookie)) {
        cookieStr = cookie[0]
      } else if (typeof cookie === 'string') {
        cookieStr = cookie
      }
      cookieStr = cookieStr.split(';')[0]

      expect(cookieStr).not.toBe('')

      await createTestApp(app)
        .get('/profile')
        .set('Cookie', cookieStr)
        .expect(200)
        .expect('User ID: 456')
    })
  })
})

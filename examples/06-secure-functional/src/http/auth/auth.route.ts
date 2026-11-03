import { controller, route } from 'exisjs/router'
import { rateLimit } from 'exisjs/middleware'
import { revokeSession } from '@/common/session'
import { SESSION_COOKIE, sessionCookieOptions } from '@/common/session-cookie'
import { loginBody, registerBody } from './auth.schema'
import * as auth from './auth.service'

const loginLimit = rateLimit({ windowMs: 60_000, max: 10 })

export default controller({
  csrf: route.get('/csrf', {
    public: true,
    handle: ({ req }) => ({ csrfToken: req.csrfToken }),
  }),

  register: route.post('/register', {
    public: true,
    body: registerBody,
    httpCode: 201,
    handle: ({ body }) => auth.register(body),
  }),

  login: route.post('/login', {
    public: true,
    middleware: [loginLimit],
    body: loginBody,
    async handle({ body, res }) {
      const token = await auth.login(body.email, body.password)
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions)
      return { ok: true }
    },
  }),

  logout: route.post('/logout', {
    async handle({ req, res }) {
      await revokeSession(req.cookies[SESSION_COOKIE])
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions)
      return { ok: true }
    },
  }),

  me: route.get('/me', {
    handle: ({ req }) => req.user,
  }),
})

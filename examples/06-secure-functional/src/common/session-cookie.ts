export const SESSION_COOKIE = 'session'

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'Lax' as const,
  secure: process.env.NODE_ENV === 'production' && !process.env.INSECURE_COOKIES,
  path: '/',
  maxAge: 3600,
}

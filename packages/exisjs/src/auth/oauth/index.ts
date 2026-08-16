/**
 * ExisJS OAuth Provider System
 *
 * A complete OAuth 2.0 / OpenID Connect implementation with built-in providers
 * for Google, GitHub, Microsoft, Discord, and Facebook. Includes PKCE support,
 * state validation, profile normalization, and route middleware helpers.
 *
 * @example
 * ```ts
 * import { OAuth } from 'exisjs/auth'
 *
 * // Configure providers
 * OAuth.configure({
 *   google: {
 *     clientId: process.env.GOOGLE_CLIENT_ID!,
 *     clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *     redirectUri: 'http://localhost:3000/auth/google/callback',
 *   },
 *   github: {
 *     clientId: process.env.GITHUB_CLIENT_ID!,
 *     clientSecret: process.env.GITHUB_CLIENT_SECRET!,
 *     redirectUri: 'http://localhost:3000/auth/github/callback',
 *   },
 * })
 *
 * // Use middleware
 * app.get('/auth/google', oauthRedirect('google'))
 * app.get('/auth/google/callback', oauthCallback('google', {
 *   onSuccess: async (req, res, profile) => {
 *     req.session.userId = profile.id
 *     res.redirect('/dashboard')
 *   },
 * }))
 * ```
 */

// ─── Core ────────────────────────────────────────────────────────────────────
export {
  OAuthManager,
  OAuth,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from './core'

// ─── Middleware ───────────────────────────────────────────────────────────────
export { oauthRedirect, oauthCallback, requireAuth } from './middleware'

// ─── Providers ───────────────────────────────────────────────────────────────
export { GoogleProvider } from './providers/google'
export { GithubProvider } from './providers/github'
export { MicrosoftProvider } from './providers/microsoft'
export { DiscordProvider } from './providers/discord'
export { FacebookProvider } from './providers/facebook'
export { CustomProvider } from './providers/custom'

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  OAuthProvider,
  OAuthProviderConfig,
  OAuthProviderAdapter,
  OAuthTokens,
  OAuthUserProfile,
  OAuthCallbackOptions,
  OAuthFlowState,
  CustomOAuthProviderConfig,
} from './types'

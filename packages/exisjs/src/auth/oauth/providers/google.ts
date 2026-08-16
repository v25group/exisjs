/**
 * Google OAuth 2.0 + OpenID Connect Provider.
 *
 * Endpoints:
 *   Auth:     https://accounts.google.com/o/oauth2/v2/auth
 *   Token:    https://oauth2.googleapis.com/token
 *   UserInfo: https://www.googleapis.com/oauth2/v3/userinfo
 *   Revoke:   https://oauth2.googleapis.com/revoke
 *
 * Default scopes: openid, email, profile
 */

import { createHash } from 'node:crypto'
import type {
  OAuthProviderAdapter,
  OAuthProviderConfig,
  OAuthTokens,
  OAuthUserProfile,
} from '../types'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

const DEFAULT_SCOPES = ['openid', 'email', 'profile']

export class GoogleProvider implements OAuthProviderAdapter {
  readonly name = 'google' as const

  private config: OAuthProviderConfig

  constructor(config: OAuthProviderConfig) {
    this.config = config
  }

  getAuthorizationUrl(state: string, codeVerifier?: string): string {
    const scopes = this.config.scopes || DEFAULT_SCOPES
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      access_type: 'offline', // Request refresh token
      prompt: 'consent',
    })

    if (codeVerifier) {
      const challenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url')
      params.set('code_challenge', challenge)
      params.set('code_challenge_method', 'S256')
    }

    return `${AUTH_URL}?${params.toString()}`
  }

  async exchangeCode(
    code: string,
    codeVerifier?: string
  ): Promise<OAuthTokens> {
    const body: Record<string, string> = {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
    }

    if (codeVerifier) {
      body.code_verifier = codeVerifier
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Google token exchange failed: ${error}`)
    }

    const data = (await response.json()) as any

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type || 'Bearer',
      idToken: data.id_token,
      scope: data.scope,
    }
  }

  async getUserProfile(tokens: OAuthTokens): Promise<OAuthUserProfile> {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })

    if (!response.ok) {
      throw new Error(`Google user info request failed: ${response.statusText}`)
    }

    const data = (await response.json()) as any

    return {
      id: data.sub,
      email: data.email,
      emailVerified: data.email_verified ?? false,
      name:
        data.name ||
        `${data.given_name || ''} ${data.family_name || ''}`.trim(),
      firstName: data.given_name,
      lastName: data.family_name,
      avatar: data.picture,
      provider: 'google',
      raw: data,
    }
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Google token refresh failed: ${error}`)
    }

    const data = (await response.json()) as any

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in,
      tokenType: data.token_type || 'Bearer',
      idToken: data.id_token,
      scope: data.scope,
    }
  }

  async revokeToken(token: string): Promise<void> {
    const response = await fetch(
      `${REVOKE_URL}?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Google token revocation failed: ${error}`)
    }
  }
}

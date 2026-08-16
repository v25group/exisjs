/**
 * Custom OAuth Provider.
 *
 * A generic adapter for any OAuth 2.0 compliant provider that isn't
 * built in. Configure with your own auth/token/userinfo URLs and
 * an optional profile mapping function.
 *
 * @example
 * ```ts
 * import { OAuth } from 'exisjs/auth'
 *
 * OAuth.custom({
 *   name: 'keycloak',
 *   authUrl: 'https://keycloak.example.com/realms/main/protocol/openid-connect/auth',
 *   tokenUrl: 'https://keycloak.example.com/realms/main/protocol/openid-connect/token',
 *   userInfoUrl: 'https://keycloak.example.com/realms/main/protocol/openid-connect/userinfo',
 *   clientId: process.env.KC_CLIENT_ID!,
 *   clientSecret: process.env.KC_CLIENT_SECRET!,
 *   redirectUri: 'http://localhost:3000/auth/keycloak/callback',
 *   scopes: ['openid', 'profile', 'email'],
 *   mapProfile: (raw) => ({
 *     id: raw.sub as string,
 *     email: raw.email as string,
 *     emailVerified: raw.email_verified as boolean,
 *     name: raw.preferred_username as string,
 *   }),
 * })
 * ```
 */

import { createHash } from 'node:crypto'
import type {
  OAuthProviderAdapter,
  OAuthTokens,
  OAuthUserProfile,
  CustomOAuthProviderConfig,
} from '../types'

export class CustomProvider implements OAuthProviderAdapter {
  readonly name: string

  private config: CustomOAuthProviderConfig

  constructor(config: CustomOAuthProviderConfig) {
    this.name = config.name
    this.config = config
  }

  getAuthorizationUrl(state: string, codeVerifier?: string): string {
    const scopes = this.config.scopes || []
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      state,
    })

    if (scopes.length > 0) {
      params.set('scope', scopes.join(' '))
    }

    if (codeVerifier) {
      const challenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url')
      params.set('code_challenge', challenge)
      params.set('code_challenge_method', 'S256')
    }

    return `${this.config.authUrl}?${params.toString()}`
  }

  async exchangeCode(
    code: string,
    codeVerifier?: string
  ): Promise<OAuthTokens> {
    const body: Record<string, string> = {
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
    }

    if (codeVerifier) {
      body.code_verifier = codeVerifier
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    }

    if (this.config.authMethod === 'header') {
      // Send client credentials as Basic auth header
      headers.Authorization =
        'Basic ' +
        Buffer.from(
          `${this.config.clientId}:${this.config.clientSecret}`
        ).toString('base64')
    } else {
      // Send client credentials in the request body (default)
      body.client_id = this.config.clientId
      body.client_secret = this.config.clientSecret
    }

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers,
      body: new URLSearchParams(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`${this.name} token exchange failed: ${error}`)
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
    const response = await fetch(this.config.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })

    if (!response.ok) {
      throw new Error(
        `${this.name} user info request failed: ${response.statusText}`
      )
    }

    const raw = (await response.json()) as Record<string, unknown>

    // Use custom profile mapper if provided
    if (this.config.mapProfile) {
      const mapped = this.config.mapProfile(raw)
      return {
        ...mapped,
        emailVerified: mapped.emailVerified ?? false,
        provider: this.name,
        raw,
      }
    }

    // Best-effort field mapping for common OpenID Connect fields
    return {
      id: String(raw.sub || raw.id || raw.user_id || ''),
      email: String(raw.email || ''),
      emailVerified: (raw.email_verified as boolean) ?? false,
      name: String(
        raw.name ||
          raw.preferred_username ||
          raw.username ||
          raw.display_name ||
          ''
      ),
      firstName: raw.given_name as string | undefined,
      lastName: raw.family_name as string | undefined,
      avatar: (raw.picture || raw.avatar || raw.avatar_url) as
        string | undefined,
      provider: this.name,
      raw,
    }
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const body: Record<string, string> = {
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    }

    if (this.config.authMethod === 'header') {
      headers.Authorization =
        'Basic ' +
        Buffer.from(
          `${this.config.clientId}:${this.config.clientSecret}`
        ).toString('base64')
    } else {
      body.client_id = this.config.clientId
      body.client_secret = this.config.clientSecret
    }

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers,
      body: new URLSearchParams(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`${this.name} token refresh failed: ${error}`)
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
    if (!this.config.revokeUrl) {
      throw new Error(
        `${this.name} does not have a revocation endpoint configured. ` +
          'Set revokeUrl in the provider config.'
      )
    }

    const body: Record<string, string> = { token }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    if (this.config.authMethod === 'header') {
      headers.Authorization =
        'Basic ' +
        Buffer.from(
          `${this.config.clientId}:${this.config.clientSecret}`
        ).toString('base64')
    } else {
      body.client_id = this.config.clientId
      body.client_secret = this.config.clientSecret
    }

    const response = await fetch(this.config.revokeUrl, {
      method: 'POST',
      headers,
      body: new URLSearchParams(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`${this.name} token revocation failed: ${error}`)
    }
  }
}

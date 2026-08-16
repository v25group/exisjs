/**
 * Microsoft Entra ID (Azure AD) OAuth Provider.
 *
 * Endpoints:
 *   Auth:     https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
 *   Token:    https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *   UserInfo: https://graph.microsoft.com/v1.0/me
 *
 * Supports multi-tenant ('common'), organizations-only ('organizations'),
 * or a specific tenant ID.
 *
 * Default scopes: openid, email, profile, User.Read
 */

import { createHash } from 'node:crypto'
import type {
  OAuthProviderAdapter,
  OAuthProviderConfig,
  OAuthTokens,
  OAuthUserProfile,
} from '../types'

const USERINFO_URL = 'https://graph.microsoft.com/v1.0/me'
const DEFAULT_SCOPES = ['openid', 'email', 'profile', 'User.Read']

export class MicrosoftProvider implements OAuthProviderAdapter {
  readonly name = 'microsoft' as const

  private config: OAuthProviderConfig
  private tenant: string

  constructor(config: OAuthProviderConfig) {
    this.config = config
    this.tenant = config.tenant || 'common'
  }

  private get authUrl(): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize`
  }

  private get tokenUrl(): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`
  }

  getAuthorizationUrl(state: string, codeVerifier?: string): string {
    const scopes = this.config.scopes || DEFAULT_SCOPES
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      response_mode: 'query',
    })

    if (codeVerifier) {
      const challenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url')
      params.set('code_challenge', challenge)
      params.set('code_challenge_method', 'S256')
    }

    return `${this.authUrl}?${params.toString()}`
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

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Microsoft token exchange failed: ${error}`)
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
      throw new Error(
        `Microsoft user info request failed: ${response.statusText}`
      )
    }

    const data = (await response.json()) as any

    return {
      id: data.id,
      email: data.mail || data.userPrincipalName || '',
      emailVerified: true, // Microsoft verifies emails by default
      name: data.displayName || '',
      firstName: data.givenName,
      lastName: data.surname,
      avatar: undefined, // Graph API requires a separate photo request
      provider: 'microsoft',
      raw: data,
    }
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const response = await fetch(this.tokenUrl, {
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
      throw new Error(`Microsoft token refresh failed: ${error}`)
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

  async revokeToken(_token: string): Promise<void> {
    // Microsoft's v2.0 endpoint does not have a standard revocation endpoint.
    // Token revocation is handled via the admin portal or by signing the user out.
    // The logout URL can be used instead:
    //   https://login.microsoftonline.com/{tenant}/oauth2/v2.0/logout
    throw new Error(
      'Microsoft does not provide a standard token revocation endpoint. ' +
        'Use the logout endpoint or revoke via the Azure admin portal.'
    )
  }
}

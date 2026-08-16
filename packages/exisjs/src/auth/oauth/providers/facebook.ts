/**
 * Facebook OAuth Provider.
 *
 * Endpoints:
 *   Auth:     https://www.facebook.com/v19.0/dialog/oauth
 *   Token:    https://graph.facebook.com/v19.0/oauth/access_token
 *   UserInfo: https://graph.facebook.com/v19.0/me
 *
 * Default scopes: email, public_profile
 *
 * Note: Facebook uses Graph API versioning. This implementation uses v19.0.
 */

import type {
  OAuthProviderAdapter,
  OAuthProviderConfig,
  OAuthTokens,
  OAuthUserProfile,
} from '../types'

const GRAPH_VERSION = 'v19.0'
const AUTH_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`
const TOKEN_URL = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`
const USERINFO_URL = `https://graph.facebook.com/${GRAPH_VERSION}/me`

const DEFAULT_SCOPES = ['email', 'public_profile']

export class FacebookProvider implements OAuthProviderAdapter {
  readonly name = 'facebook' as const

  private config: OAuthProviderConfig

  constructor(config: OAuthProviderConfig) {
    this.config = config
  }

  getAuthorizationUrl(state: string, _codeVerifier?: string): string {
    const scopes = this.config.scopes || DEFAULT_SCOPES
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: scopes.join(','),
      state,
    })

    return `${AUTH_URL}?${params.toString()}`
  }

  async exchangeCode(
    code: string,
    _codeVerifier?: string
  ): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri,
    })

    const response = await fetch(`${TOKEN_URL}?${params.toString()}`, {
      method: 'GET',
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Facebook token exchange failed: ${error}`)
    }

    const data = (await response.json()) as any

    if (data.error) {
      throw new Error(
        `Facebook token exchange failed: ${data.error.message || data.error}`
      )
    }

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type || 'Bearer',
    }
  }

  async getUserProfile(tokens: OAuthTokens): Promise<OAuthUserProfile> {
    const fields = 'id,name,email,first_name,last_name,picture.type(large)'
    const response = await fetch(
      `${USERINFO_URL}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(tokens.accessToken)}`
    )

    if (!response.ok) {
      throw new Error(
        `Facebook user info request failed: ${response.statusText}`
      )
    }

    const data = (await response.json()) as any

    if (data.error) {
      throw new Error(
        `Facebook user info request failed: ${data.error.message || data.error}`
      )
    }

    // Extract profile picture URL
    const avatar = data.picture?.data?.url || undefined

    return {
      id: data.id,
      email: data.email || '',
      emailVerified: !!data.email, // Facebook only returns email if verified
      name: data.name || '',
      firstName: data.first_name,
      lastName: data.last_name,
      avatar,
      provider: 'facebook',
      raw: data,
    }
  }

  async refreshToken(_refreshToken: string): Promise<OAuthTokens> {
    // Facebook uses long-lived tokens instead of refresh tokens
    // To extend a token, exchange a short-lived token for a long-lived one
    throw new Error(
      'Facebook does not support standard refresh tokens. ' +
        'Use the long-lived token exchange endpoint instead: ' +
        `${TOKEN_URL}?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=...`
    )
  }

  /**
   * Exchange a short-lived token for a long-lived token (~60 days).
   */
  async exchangeForLongLived(shortLivedToken: string): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      fb_exchange_token: shortLivedToken,
    })

    const response = await fetch(`${TOKEN_URL}?${params.toString()}`)

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Facebook long-lived token exchange failed: ${error}`)
    }

    const data = (await response.json()) as any

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type || 'Bearer',
    }
  }

  async revokeToken(token: string): Promise<void> {
    // Facebook uses a DELETE request to revoke permissions
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/permissions?access_token=${encodeURIComponent(token)}`,
      { method: 'DELETE' }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Facebook token revocation failed: ${error}`)
    }
  }
}

/**
 * Discord OAuth Provider.
 *
 * Endpoints:
 *   Auth:     https://discord.com/api/oauth2/authorize
 *   Token:    https://discord.com/api/oauth2/token
 *   UserInfo: https://discord.com/api/v10/users/@me
 *   Revoke:   https://discord.com/api/oauth2/token/revoke
 *
 * Default scopes: identify, email
 */

import type {
  OAuthProviderAdapter,
  OAuthProviderConfig,
  OAuthTokens,
  OAuthUserProfile,
} from '../types'

const AUTH_URL = 'https://discord.com/api/oauth2/authorize'
const TOKEN_URL = 'https://discord.com/api/oauth2/token'
const USERINFO_URL = 'https://discord.com/api/v10/users/@me'
const REVOKE_URL = 'https://discord.com/api/oauth2/token/revoke'

const DEFAULT_SCOPES = ['identify', 'email']

export class DiscordProvider implements OAuthProviderAdapter {
  readonly name = 'discord' as const

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
      scope: scopes.join(' '),
      state,
    })

    return `${AUTH_URL}?${params.toString()}`
  }

  async exchangeCode(
    code: string,
    _codeVerifier?: string
  ): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.config.redirectUri,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Discord token exchange failed: ${error}`)
    }

    const data = (await response.json()) as any

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
    }
  }

  async getUserProfile(tokens: OAuthTokens): Promise<OAuthUserProfile> {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })

    if (!response.ok) {
      throw new Error(
        `Discord user info request failed: ${response.statusText}`
      )
    }

    const data = (await response.json()) as any

    // Build avatar URL
    let avatar: string | undefined
    if (data.avatar) {
      const ext = data.avatar.startsWith('a_') ? 'gif' : 'png'
      avatar = `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${ext}`
    }

    // Discord username: pre-2023 has discriminator, post-2023 uses display name
    const displayName = data.global_name || data.username || ''

    return {
      id: data.id,
      email: data.email || '',
      emailVerified: data.verified ?? false,
      name: displayName,
      firstName: undefined,
      lastName: undefined,
      avatar,
      provider: 'discord',
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
      throw new Error(`Discord token refresh failed: ${error}`)
    }

    const data = (await response.json()) as any

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
    }
  }

  async revokeToken(token: string): Promise<void> {
    const response = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        token,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Discord token revocation failed: ${error}`)
    }
  }
}

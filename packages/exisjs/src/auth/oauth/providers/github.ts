/**
 * GitHub OAuth Provider.
 *
 * Endpoints:
 *   Auth:     https://github.com/login/oauth/authorize
 *   Token:    https://github.com/login/oauth/access_token
 *   UserInfo: https://api.github.com/user
 *   Emails:   https://api.github.com/user/emails
 *
 * Default scopes: user:email, read:user
 *
 * Note: GitHub does not support PKCE or refresh tokens in the standard OAuth flow.
 */

import type {
  OAuthProviderAdapter,
  OAuthProviderConfig,
  OAuthTokens,
  OAuthUserProfile,
} from '../types'

const AUTH_URL = 'https://github.com/login/oauth/authorize'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USERINFO_URL = 'https://api.github.com/user'
const EMAILS_URL = 'https://api.github.com/user/emails'

const DEFAULT_SCOPES = ['user:email', 'read:user']

export class GithubProvider implements OAuthProviderAdapter {
  readonly name = 'github' as const

  private config: OAuthProviderConfig

  constructor(config: OAuthProviderConfig) {
    this.config = config
  }

  getAuthorizationUrl(state: string, _codeVerifier?: string): string {
    const scopes = this.config.scopes || DEFAULT_SCOPES
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
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
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GitHub token exchange failed: ${error}`)
    }

    const data = (await response.json()) as any

    if (data.error) {
      throw new Error(
        `GitHub token exchange failed: ${data.error_description || data.error}`
      )
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
    }
  }

  async getUserProfile(tokens: OAuthTokens): Promise<OAuthUserProfile> {
    const headers = {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: 'application/json',
    }

    // Fetch user info
    const userResponse = await fetch(USERINFO_URL, { headers })
    if (!userResponse.ok) {
      throw new Error(
        `GitHub user info request failed: ${userResponse.statusText}`
      )
    }
    const userData = (await userResponse.json()) as any

    // Fetch emails (since the user endpoint might not include email)
    let email = userData.email || ''
    let emailVerified = false

    if (!email || tokens.scope?.includes('user:email')) {
      try {
        const emailsResponse = await fetch(EMAILS_URL, { headers })
        if (emailsResponse.ok) {
          const emails = (await emailsResponse.json()) as any[]
          const primaryEmail = emails.find((e: any) => e.primary) || emails[0]
          if (primaryEmail) {
            email = primaryEmail.email
            emailVerified = primaryEmail.verified ?? false
          }
        }
      } catch {
        // Non-critical: proceed with whatever email we have
      }
    }

    // Parse name
    const fullName = userData.name || userData.login || ''
    const nameParts = fullName.split(' ')

    return {
      id: String(userData.id),
      email,
      emailVerified,
      name: fullName,
      firstName: nameParts[0] || undefined,
      lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined,
      avatar: userData.avatar_url,
      provider: 'github',
      raw: userData,
    }
  }

  async refreshToken(_refreshToken: string): Promise<OAuthTokens> {
    throw new Error(
      'GitHub OAuth does not support refresh tokens in the standard flow. ' +
        'The user must re-authenticate.'
    )
  }

  async revokeToken(token: string): Promise<void> {
    // GitHub uses the application API to revoke tokens
    const response = await fetch(
      `https://api.github.com/applications/${this.config.clientId}/token`,
      {
        method: 'DELETE',
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(
              `${this.config.clientId}:${this.config.clientSecret}`
            ).toString('base64'),
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify({ access_token: token }),
      }
    )

    if (!response.ok && response.status !== 404) {
      const error = await response.text()
      throw new Error(`GitHub token revocation failed: ${error}`)
    }
  }
}

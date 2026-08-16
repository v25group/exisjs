/**
 * OAuth Manager — The core orchestration engine.
 *
 * Manages OAuth provider registrations, generates authorization URLs with
 * PKCE + state, handles the token exchange callback, and normalizes user profiles.
 *
 * Usage:
 *   import { OAuth } from 'exisjs/auth'
 *
 *   OAuth.configure({
 *     google: { clientId: '...', clientSecret: '...', redirectUri: '...' },
 *     github: { clientId: '...', clientSecret: '...', redirectUri: '...' },
 *   })
 *
 *   const { url, state, codeVerifier } = OAuth.getAuthUrl('google')
 *   const { profile, tokens } = await OAuth.handleCallback('google', code, codeVerifier)
 */

import { randomBytes, createHash } from 'node:crypto'
import type {
  OAuthProvider,
  OAuthProviderConfig,
  OAuthProviderAdapter,
  OAuthTokens,
  OAuthUserProfile,
  OAuthFlowState,
  CustomOAuthProviderConfig,
} from './types'

// ─── Provider Factories ──────────────────────────────────────────────────────

function createBuiltInProvider(
  name: OAuthProvider,
  config: OAuthProviderConfig
): OAuthProviderAdapter {
  switch (name) {
    case 'google': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GoogleProvider } = require('./providers/google')
      return new GoogleProvider(config)
    }
    case 'github': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GithubProvider } = require('./providers/github')
      return new GithubProvider(config)
    }
    case 'microsoft': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MicrosoftProvider } = require('./providers/microsoft')
      return new MicrosoftProvider(config)
    }
    case 'discord': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DiscordProvider } = require('./providers/discord')
      return new DiscordProvider(config)
    }
    case 'facebook': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { FacebookProvider } = require('./providers/facebook')
      return new FacebookProvider(config)
    }
    default:
      throw new Error(
        `Unknown OAuth provider '${name}'. Use OAuth.custom() for custom providers.`
      )
  }
}

// ─── PKCE Helpers ────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random code verifier for PKCE.
 */
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Derive the code challenge from a code verifier using S256 method.
 */
function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/**
 * Generate a cryptographically random state token for CSRF protection.
 */
function generateState(): string {
  return randomBytes(24).toString('base64url')
}

// ─── OAuth Manager ───────────────────────────────────────────────────────────

export class OAuthManager {
  private providers = new Map<string, OAuthProviderAdapter>()

  /**
   * Configure multiple OAuth providers at once.
   */
  configure(providers: Record<string, OAuthProviderConfig>): this {
    for (const [name, config] of Object.entries(providers)) {
      this.register(name, config)
    }
    return this
  }

  /**
   * Register a single OAuth provider.
   */
  register(name: string, config: OAuthProviderConfig): this {
    const adapter = createBuiltInProvider(name, config)
    this.providers.set(name, adapter)
    return this
  }

  /**
   * Register a custom OAuth provider.
   */
  custom(config: CustomOAuthProviderConfig): this {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CustomProvider } = require('./providers/custom')
    const adapter = new CustomProvider(config)
    this.providers.set(config.name, adapter)
    return this
  }

  /**
   * Register a fully custom provider adapter directly.
   */
  registerAdapter(name: string, adapter: OAuthProviderAdapter): this {
    this.providers.set(name, adapter)
    return this
  }

  /**
   * Generate the authorization URL for a provider.
   * Returns the URL, state token, and PKCE code verifier.
   */
  getAuthUrl(
    provider: string,
    options?: { usePKCE?: boolean; additionalParams?: Record<string, string> }
  ): {
    url: string
    state: string
    codeVerifier?: string
    flowState: OAuthFlowState
  } {
    const adapter = this.getProvider(provider)
    const state = generateState()
    const usePKCE = options?.usePKCE !== false // PKCE on by default

    let codeVerifier: string | undefined
    let url: string

    if (usePKCE) {
      codeVerifier = generateCodeVerifier()
      url = adapter.getAuthorizationUrl(state, codeVerifier)
    } else {
      url = adapter.getAuthorizationUrl(state)
    }

    // Append any additional query params
    if (options?.additionalParams) {
      const urlObj = new URL(url)
      for (const [key, value] of Object.entries(options.additionalParams)) {
        urlObj.searchParams.set(key, value)
      }
      url = urlObj.toString()
    }

    const flowState: OAuthFlowState = {
      state,
      codeVerifier,
      provider,
      createdAt: Date.now(),
    }

    return { url, state, codeVerifier, flowState }
  }

  /**
   * Handle the OAuth callback — exchange the authorization code for tokens
   * and fetch the user profile.
   */
  async handleCallback(
    provider: string,
    code: string,
    codeVerifier?: string
  ): Promise<{ profile: OAuthUserProfile; tokens: OAuthTokens }> {
    const adapter = this.getProvider(provider)

    // Exchange the code for tokens
    const tokens = await adapter.exchangeCode(code, codeVerifier)

    // Fetch the user profile
    const profile = await adapter.getUserProfile(tokens)

    return { profile, tokens }
  }

  /**
   * Refresh an expired access token.
   */
  async refreshAccessToken(
    provider: string,
    refreshToken: string
  ): Promise<OAuthTokens> {
    const adapter = this.getProvider(provider)
    return adapter.refreshToken(refreshToken)
  }

  /**
   * Revoke a token.
   */
  async revokeToken(provider: string, token: string): Promise<void> {
    const adapter = this.getProvider(provider)
    return adapter.revokeToken(token)
  }

  /**
   * Get a registered provider adapter.
   */
  getProvider(name: string): OAuthProviderAdapter {
    const adapter = this.providers.get(name)
    if (!adapter) {
      throw new Error(
        `OAuth provider '${name}' is not registered. Call OAuth.register() or OAuth.configure() first.`
      )
    }
    return adapter
  }

  /**
   * Check if a provider is registered.
   */
  hasProvider(name: string): boolean {
    return this.providers.has(name)
  }

  /**
   * Get all registered provider names.
   */
  getProviderNames(): string[] {
    return Array.from(this.providers.keys())
  }
}

// ─── Singleton & Exports ─────────────────────────────────────────────────────

/**
 * Default global OAuthManager instance.
 */
export const OAuth = new OAuthManager()

// Export helpers for advanced use
export { generateCodeVerifier, generateCodeChallenge, generateState }

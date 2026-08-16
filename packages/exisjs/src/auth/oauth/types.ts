// ─── OAuth Types ────────────────────────────────────────────────────────────────

/**
 * Built-in OAuth provider identifiers.
 */
export type OAuthProvider =
  'google' | 'github' | 'microsoft' | 'discord' | 'facebook' | (string & {})

/**
 * Configuration for an OAuth provider.
 */
export interface OAuthProviderConfig {
  /** OAuth client ID (from the provider's developer console) */
  clientId: string
  /** OAuth client secret */
  clientSecret: string
  /** The URL the provider redirects to after authentication */
  redirectUri: string
  /** OAuth scopes to request */
  scopes?: string[]
  /**
   * Microsoft-specific: the tenant ID.
   * Use 'common' for multi-tenant, 'organizations' for work accounts, or a specific tenant ID.
   * Default: 'common'
   */
  tenant?: string
}

/**
 * Token response from an OAuth provider.
 */
export interface OAuthTokens {
  /** The access token used to call provider APIs */
  accessToken: string
  /** The refresh token for obtaining new access tokens (if granted) */
  refreshToken?: string
  /** Token expiry time in seconds */
  expiresIn?: number
  /** Token type (usually 'Bearer') */
  tokenType: string
  /** OpenID Connect ID token (JWT, if using openid scope) */
  idToken?: string
  /** The scopes that were actually granted by the provider */
  scope?: string
}

/**
 * Normalized user profile across all providers.
 * Guarantees a consistent shape regardless of which provider is used.
 */
export interface OAuthUserProfile {
  /** User's unique ID on the provider */
  id: string
  /** User's email address */
  email: string
  /** Whether the provider has verified the email */
  emailVerified: boolean
  /** User's display name */
  name: string
  /** User's first name (if available) */
  firstName?: string
  /** User's last name (if available) */
  lastName?: string
  /** URL to the user's avatar/profile picture */
  avatar?: string
  /** Which OAuth provider this profile came from */
  provider: OAuthProvider
  /** The full raw response from the provider's user info endpoint */
  raw: Record<string, unknown>
}

/**
 * The contract that every OAuth provider adapter must implement.
 */
export interface OAuthProviderAdapter {
  /** Provider identifier */
  readonly name: OAuthProvider

  /**
   * Generate the authorization URL that the user is redirected to.
   * @param state CSRF state token
   * @param codeVerifier PKCE code verifier (if using PKCE)
   */
  getAuthorizationUrl(state: string, codeVerifier?: string): string

  /**
   * Exchange an authorization code for tokens.
   * @param code The authorization code from the callback
   * @param codeVerifier PKCE code verifier (if using PKCE)
   */
  exchangeCode(code: string, codeVerifier?: string): Promise<OAuthTokens>

  /**
   * Fetch the authenticated user's profile from the provider.
   * @param tokens The tokens obtained from exchangeCode
   */
  getUserProfile(tokens: OAuthTokens): Promise<OAuthUserProfile>

  /**
   * Refresh an expired access token using a refresh token.
   * @param refreshToken The refresh token
   */
  refreshToken(refreshToken: string): Promise<OAuthTokens>

  /**
   * Revoke a token (access or refresh).
   * @param token The token to revoke
   */
  revokeToken(token: string): Promise<void>
}

/**
 * Configuration for the OAuth middleware.
 */
export interface OAuthCallbackOptions {
  /**
   * Called when authentication succeeds.
   * Use this to create/update the user in your database, set session data, etc.
   */
  onSuccess: (
    req: import('../../types').Request,
    res: import('../../types').Response,
    profile: OAuthUserProfile,
    tokens: OAuthTokens
  ) => void | Promise<void>

  /**
   * Called when authentication fails.
   * Use this to redirect to an error page, log the error, etc.
   */
  onError?: (
    req: import('../../types').Request,
    res: import('../../types').Response,
    error: Error
  ) => void | Promise<void>

  /**
   * Name of the session key to store OAuth state. Default: '_exis_oauth_state'
   */
  stateKey?: string
}

/**
 * Configuration for a custom OAuth provider.
 */
export interface CustomOAuthProviderConfig extends OAuthProviderConfig {
  /** A unique name for this custom provider */
  name: string
  /** The authorization endpoint URL */
  authUrl: string
  /** The token exchange endpoint URL */
  tokenUrl: string
  /** The user info endpoint URL */
  userInfoUrl: string
  /**
   * Map the raw user info response to a normalized OAuthUserProfile.
   * If not provided, the raw response is used as-is with best-effort field mapping.
   */
  mapProfile?: (
    raw: Record<string, unknown>
  ) => Omit<OAuthUserProfile, 'provider' | 'raw'>
  /** The revocation endpoint URL (optional) */
  revokeUrl?: string
  /**
   * How to send the client credentials during token exchange.
   * 'body' sends them as POST body parameters.
   * 'header' sends them as a Basic auth header.
   * Default: 'body'
   */
  authMethod?: 'body' | 'header'
}

/**
 * Internal state stored during the OAuth flow.
 */
export interface OAuthFlowState {
  /** CSRF state token */
  state: string
  /** PKCE code verifier */
  codeVerifier?: string
  /** Provider being used */
  provider: OAuthProvider
  /** Timestamp when the state was created */
  createdAt: number
}

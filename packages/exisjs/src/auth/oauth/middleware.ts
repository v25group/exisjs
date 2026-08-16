/**
 * OAuth Middleware Helpers.
 *
 * Express-style middleware functions for handling OAuth redirects, callbacks,
 * and authentication guards in ExisJS route handlers.
 *
 * @example
 * ```ts
 * import { oauthRedirect, oauthCallback, requireAuth } from 'exisjs/auth/oauth'
 *
 * app.get('/auth/google', oauthRedirect('google'))
 * app.get('/auth/google/callback', oauthCallback('google', {
 *   onSuccess: async (req, res, profile, tokens) => {
 *     // Create or update user in your database
 *     req.session.userId = profile.id
 *     res.redirect('/dashboard')
 *   },
 * }))
 *
 * // Protect routes
 * app.get('/dashboard', requireAuth(), (req, res) => {
 *   res.json({ user: req.user })
 * })
 * ```
 */

import type { Request, Response, NextFunction } from '../../types'
import { HttpError } from '../../utils/errors'
import { OAuth } from './core'
import type { OAuthCallbackOptions, OAuthFlowState } from './types'

const DEFAULT_STATE_KEY = '_exis_oauth_state'
const STATE_MAX_AGE_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Middleware that redirects the user to an OAuth provider's login page.
 * Stores the state and code verifier in the user's session for validation on callback.
 *
 * @param provider The OAuth provider name (e.g. 'google', 'github')
 * @param options Optional settings like additional params or disabling PKCE
 */
export function oauthRedirect(
  provider: string,
  options?: {
    usePKCE?: boolean
    additionalParams?: Record<string, string>
    stateKey?: string
  }
) {
  return (req: Request, res: Response, _next: NextFunction) => {
    const stateKey = options?.stateKey || DEFAULT_STATE_KEY
    const { url, flowState } = OAuth.getAuthUrl(provider, {
      usePKCE: options?.usePKCE,
      additionalParams: options?.additionalParams,
    })

    // Store the flow state in session
    if (req.session) {
      req.session[stateKey] = flowState
    } else {
      // If no session middleware, store in a signed cookie
      res.cookie(stateKey, JSON.stringify(flowState), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: STATE_MAX_AGE_MS / 1000,
        path: '/',
      })
    }

    res.redirect(url)
  }
}

/**
 * Middleware that handles the OAuth callback from a provider.
 * Validates the state, exchanges the authorization code for tokens,
 * fetches the user profile, and calls the onSuccess callback.
 *
 * @param provider The OAuth provider name
 * @param options Callback options including onSuccess and onError handlers
 */
export function oauthCallback(provider: string, options: OAuthCallbackOptions) {
  const stateKey = options.stateKey || DEFAULT_STATE_KEY

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1. Extract code and state from the callback query params
      const code = req.query?.code as string
      const returnedState = req.query?.state as string
      const error = req.query?.error as string

      // Handle provider-side errors
      if (error) {
        const errorDesc = (req.query?.error_description as string) || error
        throw new Error(`OAuth error from ${provider}: ${errorDesc}`)
      }

      if (!code) {
        throw HttpError.badRequest(
          'Missing authorization code in OAuth callback'
        )
      }

      // 2. Retrieve and validate the stored state
      let flowState: OAuthFlowState | undefined

      if (req.session && req.session[stateKey]) {
        flowState = req.session[stateKey] as OAuthFlowState
        // Clean up
        delete req.session[stateKey]
      } else if (req.cookies?.[stateKey]) {
        try {
          flowState = JSON.parse(req.cookies[stateKey]) as OAuthFlowState
        } catch {
          // Invalid cookie
        }
        // Clear the cookie
        res.cookie(stateKey, '', { maxAge: 0, path: '/' })
      }

      if (!flowState) {
        throw HttpError.badRequest(
          'OAuth state not found. The session may have expired. Please try again.'
        )
      }

      // Validate state matches
      if (flowState.state !== returnedState) {
        throw HttpError.badRequest(
          'OAuth state mismatch. This may be a CSRF attack. Please try again.'
        )
      }

      // Validate state age
      if (Date.now() - flowState.createdAt > STATE_MAX_AGE_MS) {
        throw HttpError.badRequest('OAuth state has expired. Please try again.')
      }

      // Validate provider
      if (flowState.provider !== provider) {
        throw HttpError.badRequest(
          `OAuth provider mismatch. Expected '${flowState.provider}', got '${provider}'.`
        )
      }

      // 3. Exchange code for tokens and get the user profile
      const { profile, tokens } = await OAuth.handleCallback(
        provider,
        code,
        flowState.codeVerifier
      )

      // 4. Call the success handler
      await options.onSuccess(req, res, profile, tokens)
    } catch (err: any) {
      if (options.onError) {
        await options.onError(
          req,
          res,
          err instanceof Error ? err : new Error(String(err))
        )
      } else {
        next(err)
      }
    }
  }
}

/**
 * Guard middleware that ensures the user is authenticated.
 * Checks for `req.user` or `req.session.userId` to determine authentication status.
 *
 * @param options Configuration options
 */
export function requireAuth(options?: {
  /** Custom function to check if the request is authenticated */
  isAuthenticated?: (req: Request) => boolean
  /** URL to redirect to if not authenticated (for browser requests). If not set, returns 401 JSON */
  redirectTo?: string
  /** Custom error message */
  message?: string
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    let authenticated: boolean

    if (options?.isAuthenticated) {
      authenticated = options.isAuthenticated(req)
    } else {
      // Default check: req.user exists or session has a userId
      authenticated = !!(
        req.user ||
        (req.session && (req.session as any).userId)
      )
    }

    if (authenticated) {
      return next()
    }

    // Not authenticated
    if (options?.redirectTo && req.headers.accept?.includes('text/html')) {
      return res.redirect(options.redirectTo)
    }

    return next(
      HttpError.unauthorized(options?.message || 'Authentication required')
    )
  }
}

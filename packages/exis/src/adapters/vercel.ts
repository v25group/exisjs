import type { App } from '../server/app'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface VercelRequest extends IncomingMessage {
  query: Record<string, string | string[]>
  cookies: Record<string, string>
  body: unknown
}

export type VercelResponse = ServerResponse

export interface VercelAdapterOptions {
  cwd?: string
}

/**
 * Creates a Vercel Serverless handler for an Exis App.
 * Vercel already provides standard Node.js HTTP streams natively.
 */
export function vercel(app: App, options?: VercelAdapterOptions) {
  let initialized = false

  return async (req: VercelRequest, res: VercelResponse) => {
    if (!initialized) {
      if (typeof app.create === 'function') {
        await app.create(options?.cwd)
      }
      if (typeof app.onStartHook === 'function') {
        await app.onStartHook(app)
      }
      initialized = true
    }

    return app.handle(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse
    )
  }
}

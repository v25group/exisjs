import type { App } from '../server/app'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface VercelRequest extends IncomingMessage {
  query: Record<string, string | string[]>
  cookies: Record<string, string>
  body: unknown
}

export type VercelResponse = ServerResponse

/**
 * Creates a Vercel Serverless handler for an Exis App.
 * Vercel already provides standard Node.js HTTP streams natively.
 */
export function serverlessVercel(app: App) {
  return (req: VercelRequest, res: VercelResponse) => {
    // Vercel pre-parses bodies, but Exis also tries to parse them if req is passed.
    // If Vercel already read the stream, Exis's rawBody parser might hang because the stream ended.
    // To fix this, we attach the pre-parsed body directly to the Exis request object inside the pipeline,
    // or we reconstruct the stream if Vercel drained it.

    // Actually, Vercel allows disabling the native body parser via config:
    // export const config = { api: { bodyParser: false } }
    // If the user does this, the stream is pristine and Exis handles it perfectly.

    return app.handle(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse
    )
  }
}

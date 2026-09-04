import type { Request, Response } from '../router/types'
import type { App } from '../server/app'

// ─── Plugin System ──────────────────────────────────────────────────────────────

export interface ExisPlugin<TOptions = Record<string, unknown>> {
  name: string
  version?: string
  dependencies?: string[]
  encapsulate?: boolean
  register: (app: App, options?: TOptions) => void | Promise<void>
}

export interface ExisPluginInstance {
  plugin: ExisPlugin<unknown>
  options?: unknown
}

// ─── Lifecycle Hooks ────────────────────────────────────────────────────────
export type HookReady = () => void | Promise<void>
export type HookClose = () => void | Promise<void>
export type HookRequest = (req: Request, res: Response) => void | Promise<void>
export type HookResponse = (req: Request, res: Response) => void | Promise<void>
export type HookError = (
  err: Error,
  req: Request,
  res: Response
) => void | Promise<void>
export type HookRoute = (route: {
  method: string
  path: string
}) => void | Promise<void>

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Request, Response } from '../types'
import type { App } from './app'

export type ExisContext = Record<string, any>

export interface InternalContext {
  state: ExisContext
  afterCallbacks: (() => void | Promise<void>)[]
  req: Request
  res: Response
  app: App
  diCache: Map<any, any>
  cleanedUp?: boolean
}

export const executionContext = new AsyncLocalStorage<InternalContext>()

/**
 * Safely executes remaining after() callbacks, clears request-scoped DI cache,
 * purges state objects, and breaks circular references to ensure zero memory leaks.
 */
export function cleanupContext(
  store: InternalContext,
  logger?: { error: (data: any, msg: string) => void }
): void {
  if (!store || store.cleanedUp) return
  store.cleanedUp = true

  // 1. Drain and execute after() callbacks safely
  if (store.afterCallbacks && store.afterCallbacks.length > 0) {
    while (store.afterCallbacks.length > 0) {
      const cb = store.afterCallbacks.shift()
      if (cb) {
        try {
          const r = cb()
          if (r instanceof Promise) {
            r.catch((e) => {
              logger?.error({ err: e }, 'Error in after() callback')
            })
          }
        } catch (e) {
          logger?.error({ err: e }, 'Error in after() callback')
        }
      }
    }
  }

  // 2. Clear request-scoped DI cache
  if (store.diCache) {
    store.diCache.clear()
  }

  // 3. Purge request state
  if (store.state) {
    for (const key of Object.keys(store.state)) {
      delete store.state[key]
    }
  }

  // 4. Break circular references to allow V8 GC collection
  ;(store as any).req = null
  ;(store as any).res = null
  ;(store as any).app = null
}

/**
 * Retrieves the current request context state.
 * Must be called during an active request lifecycle.
 */
export function getContext<T = ExisContext>(): T {
  const store = executionContext.getStore()
  if (!store || store.cleanedUp) {
    throw new Error(
      'getContext() must be called during an active request lifecycle. Ensure asyncContext: true is set in createApp() options.'
    )
  }
  return store.state as unknown as T
}

/**
 * Sets a value in the current request context state.
 * Must be called during an active request lifecycle.
 */
export function setContext(key: string, value: any): void {
  const store = executionContext.getStore()
  if (!store || store.cleanedUp) {
    throw new Error(
      'setContext() can only be called inside an active Exis request handler.'
    )
  }
  store.state[key] = value
}

/**
 * Retrieves the current Request object.
 */
export function getRequest(): Request {
  const store = executionContext.getStore()
  if (!store || store.cleanedUp || !store.req) {
    throw new Error(
      'getRequest() can only be called inside an active Exis request handler.'
    )
  }
  return store.req
}

/**
 * Retrieves the current Response object.
 */
export function getResponse(): Response {
  const store = executionContext.getStore()
  if (!store || store.cleanedUp || !store.res) {
    throw new Error(
      'getResponse() can only be called inside an active Exis request handler.'
    )
  }
  return store.res
}

/**
 * Queues a task to be executed in the background after the response has been sent to the client.
 */
export function after(callback: () => void | Promise<void>): void {
  const store = executionContext.getStore()
  if (!store || store.cleanedUp) {
    throw new Error(
      'after() must be called during an active request lifecycle. Ensure asyncContext: true is set in createApp() options.'
    )
  }
  store.afterCallbacks.push(callback)
}

/**
 * Retrieves the active App instance from the request context.
 */
export function getApp(): App {
  const store = executionContext.getStore()
  if (!store || store.cleanedUp || !store.app) {
    throw new Error(
      'getApp() can only be called inside an active Exis request handler.'
    )
  }
  return store.app
}

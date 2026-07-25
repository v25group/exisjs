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
}

export const executionContext = new AsyncLocalStorage<InternalContext>()

/**
 * Retrieves the current request context state.
 * Must be called during an active request lifecycle.
 */
export function getContext<T = ExisContext>(): T {
  const store = executionContext.getStore()
  if (!store) {
    throw new Error(
      'getContext() can only be called inside an active Exis request handler.'
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
  if (!store) {
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
  if (!store) {
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
  if (!store) {
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
  if (!store) {
    throw new Error(
      'after() can only be called inside an active Exis request handler.'
    )
  }
  store.afterCallbacks.push(callback)
}

/**
 * Retrieves the active App instance from the request context.
 */
export function getApp(): App {
  const store = executionContext.getStore()
  if (!store) {
    throw new Error(
      'getApp() can only be called inside an active Exis request handler.'
    )
  }
  return store.app
}

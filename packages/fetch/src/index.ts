/**
 * index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Public entry point. Import everything from here:
 *
 *   import http from "./index";               // default client instance
 *   import { FetchClient, isFetchError } from "./index";
 *
 * This file is the only one that should be imported by consumers — the
 * other files (types.ts, cancel.ts, utils.ts, helpers.ts, lib.ts) are
 * implementation modules.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  Method,
  ResponseBodyType,
  ParamsSerializerOptions,
  TransferProgressEvent,
  TransformRequest,
  TransformResponse,
  BasicCredentials,
  ProxyConfig,
  AdapterResult,
  FetchRequestConfig,
  FetchResponse,
  FetchError,
  InterceptorOptions,
  InterceptorHandler,
  InterceptorManager,
  LoggerOptions,
  MockRoute,
} from './types'

// ── Cancellation ───────────────────────────────────────────────────────────
export { Cancel, CancelToken, isCancel } from './cancel'

// ── Core client + error codes / cache / form helper ───────────────────────
export { FetchClient } from './lib'
export { FetchErrorCodes, MemoryCache, toFormData } from './utils'

// ── Optional helpers ────────────────────────────────────────────────────────
export {
  createMockAdapter,
  attachLogger,
  isFetchError,
  all,
  spread,
} from './helpers'
export { createClient } from './client'
export type {
  ClientConfig,
  ClientRequestOptions,
  BuildProxyRouter,
} from './client'

// ── Default instance ────────────────────────────────────────────────────────

import { FetchClient } from './lib'
import { Cancel, CancelToken, isCancel } from './cancel'
import { toFormData } from './utils'
import {
  all,
  spread,
  isFetchError,
  createMockAdapter,
  attachLogger,
} from './helpers'
import type { LoggerOptions } from './types'

const defaultClient = new FetchClient()

// Attach statics so `fetch.create()`, `fetch.isCancel()`, etc. all work
// directly off the default export, mirroring the instance methods.
const attachedStatics = defaultClient as unknown as Record<string, unknown>
attachedStatics.create = defaultClient.create.bind(defaultClient)
attachedStatics.all = all
attachedStatics.spread = spread
attachedStatics.isCancel = isCancel
attachedStatics.isFetchError = isFetchError
attachedStatics.Cancel = Cancel
attachedStatics.CancelToken = CancelToken
attachedStatics.toFormData = toFormData
attachedStatics.createMockAdapter = createMockAdapter
attachedStatics.attachLogger = (options?: LoggerOptions) =>
  attachLogger(defaultClient, options)

export default defaultClient
export { defaultClient as fetch }

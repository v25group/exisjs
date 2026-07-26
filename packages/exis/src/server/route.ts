import type {
  Handler,
  Request,
  Response,
  HookError,
  HookResponse,
} from '../types'
import { App } from './app'
import type { ExisWebSocket } from '../websocket/socket'
import type { ExisSSE } from './sse'

/**
 * The execution context passed to every route handler.
 * It provides fully-typed, structured access to the request's properties and the ExisJS app.
 *
 * @example
 * async handle(ctx) {
 *   const { body, query, req, res, app } = ctx
 *   return { message: 'Hello World' }
 * }
 */
export interface SuperContext<B = any, Q = any, P = any> {
  body: B
  query: Q
  params: P
  headers: Record<string, string | string[] | undefined>
  req: Request
  res: Response
  app: App
  [key: string]: any
}

/**
 * Configuration options for an individual route.
 * You can define expected schemas (body, query, params, response),
 * apply route-specific middleware, and write your business logic in `handle`.
 *
 * @example
 * export default controller({
 *   login: route.post('/login', {
 *     body: { email: v.string(), password: v.string() },
 *     middleware: [rateLimiter],
 *     async handle({ body }) {
 *       return { token: '...' }
 *     }
 *   })
 * })
 */
export interface RouteConfig<B = any, Q = any, P = any> {
  body?: any
  query?: any
  params?: any
  response?: any
  cors?: any
  middleware?: Handler[]
  filters?: any | any[]
  host?: string | string[]
  handle: (ctx: SuperContext<B, Q, P>) => any | Promise<any>
}

/**
 * The execution context for a WebSocket route.
 * Injects a fully-typed native `ExisWebSocket` instance.
 */
export interface WsSuperContext<B = any, Q = any, P = any> extends SuperContext<
  B,
  Q,
  P
> {
  socket: ExisWebSocket
}

export interface WsRouteConfig<B = any, Q = any, P = any> extends Omit<
  RouteConfig<B, Q, P>,
  'handle'
> {
  handle: (ctx: WsSuperContext<B, Q, P>) => any | Promise<any>
}

/**
 * The execution context for a Server-Sent Events (SSE) route.
 * Injects a fully-typed native `ExisSSE` stream instance.
 */
export interface SseSuperContext<
  B = any,
  Q = any,
  P = any,
> extends SuperContext<B, Q, P> {
  stream: ExisSSE
}

export interface SseRouteConfig<B = any, Q = any, P = any> extends Omit<
  RouteConfig<B, Q, P>,
  'handle'
> {
  handle: (ctx: SseSuperContext<B, Q, P>) => any | Promise<any>
}

/**
 * The final built route configuration object.
 */
export type RouteDefinition<B = any, Q = any, P = any> = RouteConfig<
  B,
  Q,
  P
> & {
  method: string
  path: string
}

/**
 * Defines a new HTTP route with schema validation and a supercharged execution context.
 */
export const route = {
  /**
   * Defines a GET route.
   *
   * Example:
   *
   *     route.get('/users', {
   *       query: { search: v.string() },
   *       handle({ query }) { return { users: [] }; }
   *     })
   *
   * @param {string} path
   * @param {RouteConfig} config
   * @public
   */
  get: <B = any, Q = any, P = any>(
    path: string,
    config: RouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'get', path, ...config }),

  /**
   * Defines a POST route.
   *
   * Example:
   *
   *     route.post('/users', {
   *       body: { name: v.string() },
   *       handle({ body }) { return { success: true }; }
   *     })
   *
   * @param {string} path
   * @param {RouteConfig} config
   * @public
   */
  post: <B = any, Q = any, P = any>(
    path: string,
    config: RouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'post', path, ...config }),
  /** Defines a PUT route. */
  put: <B = any, Q = any, P = any>(
    path: string,
    config: RouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'put', path, ...config }),
  /** Defines a DELETE route. */
  delete: <B = any, Q = any, P = any>(
    path: string,
    config: RouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'delete', path, ...config }),
  /** Defines a PATCH route. */
  patch: <B = any, Q = any, P = any>(
    path: string,
    config: RouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'patch', path, ...config }),
  /** Defines an OPTIONS route. */
  options: <B = any, Q = any, P = any>(
    path: string,
    config: RouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'options', path, ...config }),
  /** Defines a HEAD route. */
  head: <B = any, Q = any, P = any>(
    path: string,
    config: RouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'head', path, ...config }),
  /** Defines a CONNECT route. */
  connect: <B = any, Q = any, P = any>(
    path: string,
    config: RouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'connect', path, ...config }),
  /** Defines a TRACE route. */
  trace: <B = any, Q = any, P = any>(
    path: string,
    config: RouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'trace', path, ...config }),
  /** Defines a custom QUERY route (e.g., for GraphQL-style operations). */
  query: <B = any, Q = any, P = any>(
    path: string,
    config: RouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'query', path, ...config }),
  /** Defines a route that matches ALL HTTP methods. */
  all: <B = any, Q = any, P = any>(
    path: string,
    config: RouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'all', path, ...config }),
  /** Defines a WebSocket route. */
  ws: <B = any, Q = any, P = any>(
    path: string,
    config: WsRouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'ws', path, ...(config as any) }),
  /** Defines a Server-Sent Events (SSE) route. */
  sse: <B = any, Q = any, P = any>(
    path: string,
    config: SseRouteConfig<B, Q, P>
  ): RouteDefinition<B, Q, P> => ({ method: 'sse', path, ...(config as any) }),
}

/**
 * Global configuration options applied to a file-level controller.
 * Any middleware or CORS settings defined here will automatically wrap all routes in the file.
 *
 * @example
 * export default controller({
 *   cors: true,
 *   middleware: [authGuard],
 *   onError: (err, req, res) => { console.log(err) },
 *
 *   myRoute: route.get('/secret', { ... })
 * })
 */
export interface ControllerConfig {
  cors?: any
  middleware?: Handler[]
  filters?: any | any[]
  onError?: HookError
  onResponse?: HookResponse
  [key: string]: any
}

/**
 * Creates a route controller. This elegantly binds multiple routes together,
 * sharing middleware and error handling, while drastically reducing boilerplate.
 *
 * @example
 * export default controller({
 *   cors: true,
 *   getUsers: route.get('/', {
 *     handle({ req, res }) {
 *       return { users: [] }
 *     }
 *   })
 * })
 */
export function controller<T extends ControllerConfig>(
  config: T
): T & { __isController: true } {
  return Object.defineProperty(config, '__isController', {
    value: true,
    enumerable: false, // Hide from iteration
  }) as T & { __isController: true }
}

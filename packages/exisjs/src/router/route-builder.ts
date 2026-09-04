import type {
  Handler,
  Request,
  Response,
  HookError,
  HookResponse,
  RouteSchema,
} from '../types'
import type { App } from '../server/app'
import type { ExisWebSocket } from '../websocket/socket'
import type { ExisSSE } from '../server/sse'

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
export type SuperContext<
  B = any,
  Q = any,
  P = any,
  TContext = Record<string, any>,
> = {
  body: B
  query: Q
  params: P
  headers: Record<string, string | string[] | undefined>
  req: Request<B, Q, P, TContext>
  res: Response
  app: App
  state: Record<string, any>
  resolve: <T>(token: import('../di/container').ProviderToken<T>) => T
  [key: string]: any
} & TContext

/**
 * Configuration options for an individual route.
 * You can define expected schemas (body, query, params, response),
 * apply route-specific middleware, and write your business logic in `handle`.
 *
 * @example
 * export default controller({
 *   createUser: route.post('/users', {
 *     body: tex.object({ email: tex.string(), password: tex.string() }),
 *     middleware: [rateLimiter],
 *     async handle({ body }) {
 *       return { token: '...' }
 *     }
 *   })
 * })
 */

export interface BaseRouteConfig<TContext = Record<string, any>> {
  cors?: any
  middleware?: Handler<any, any, any, any, TContext>[]
  filters?: any | any[]
  host?: string | string[]
}

export type RouteConfig<
  B = any,
  Q = any,
  P = any,
  TContext = Record<string, any>,
> = BaseRouteConfig<TContext> &
  RouteSchema<B, Q, P, any, TContext> & {
    handle: (ctx: SuperContext<B, Q, P, TContext>) => any | Promise<any>
  }

/**
 * The execution context for a WebSocket route.
 * Injects a fully-typed native `ExisWebSocket` instance.
 */
export type WsSuperContext<
  B = any,
  Q = any,
  P = any,
  TContext = Record<string, any>,
> = SuperContext<B, Q, P, TContext> & {
  socket: ExisWebSocket
}

export type WsRouteConfig<
  B = any,
  Q = any,
  P = any,
  TContext = Record<string, any>,
> = BaseRouteConfig<TContext> &
  RouteSchema<B, Q, P, any, TContext> & {
    handle: (ctx: WsSuperContext<B, Q, P, TContext>) => any | Promise<any>
  }

/**
 * The execution context for a Server-Sent Events (SSE) route.
 * Injects a fully-typed native `ExisSSE` stream instance.
 */
export type SseSuperContext<
  B = any,
  Q = any,
  P = any,
  TContext = Record<string, any>,
> = SuperContext<B, Q, P, TContext> & {
  stream: ExisSSE
}

export type SseRouteConfig<
  B = any,
  Q = any,
  P = any,
  TContext = Record<string, any>,
> = BaseRouteConfig<TContext> &
  RouteSchema<B, Q, P, any, TContext> & {
    handle: (ctx: SseSuperContext<B, Q, P, TContext>) => any | Promise<any>
  }

/**
 * The final built route configuration object.
 */
export type RouteDefinition<
  B = any,
  Q = any,
  P = any,
  TContext = Record<string, any>,
> = RouteConfig<B, Q, P, TContext> & {
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
   *       // Validate the query string
   *       query: tex.object({ search: tex.string() }),
   *
   *       async handle(ctx) {
   *         // ctx.query is typed as { search: string }
   *       }
   *     })
   *
   * @param {string} path
   * @param {RouteConfig} config
   * @public
   */
  get: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> => {
    if ('body' in config && config.body) {
      console.warn(
        `\x1b[33m[ExisJS] Warning: GET route '${path}' defines a body schema, but GET requests cannot have bodies.\x1b[0m`
      )
    }
    return { method: 'get', path, ...config } as any
  },

  post: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'post', path, ...config }) as any,

  put: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'put', path, ...config }) as any,

  delete: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'delete', path, ...config }) as any,

  patch: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'patch', path, ...config }) as any,

  options: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'options', path, ...config }) as any,

  head: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'head', path, ...config }) as any,

  connect: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'connect', path, ...config }) as any,

  trace: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'trace', path, ...config }) as any,

  query: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'query', path, ...config }) as any,

  all: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'all', path, ...config }) as any,
  /** Defines a WebSocket route. */
  ws: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: WsRouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'ws', path, ...config }) as any,
  /** Defines a Server-Sent Events (SSE) route. */
  sse: <
    B = unknown,
    Q = Record<string, string>,
    P = Record<string, string>,
    TContext = Record<string, any>,
  >(
    path: string,
    config: SseRouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'sse', path, ...config }) as any,
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

/**
 * Creates a strongly-typed router and controller factory.
 * This is the recommended way to type your context globally across an app.
 *
 * @example
 * interface MyContext {
 *   user: User;
 *   workspace: Workspace;
 * }
 * export const { route, controller } = createRouter<MyContext>();
 */
export function createRouter<TContext = Record<string, any>>() {
  return {
    route: route as unknown as typeof route & {
      get: <B = any, Q = any, P = any>(
        path: string,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      post: <B = any, Q = any, P = any>(
        path: string,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      put: <B = any, Q = any, P = any>(
        path: string,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      patch: <B = any, Q = any, P = any>(
        path: string,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      delete: <B = any, Q = any, P = any>(
        path: string,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      all: <B = any, Q = any, P = any>(
        path: string,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      ws: <B = any, Q = any, P = any>(
        path: string,
        config: WsRouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      sse: <B = any, Q = any, P = any>(
        path: string,
        config: SseRouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
    },
    controller: <T extends ControllerConfig>(
      config: T
    ): T & { __isController: true } => controller(config),
  }
}

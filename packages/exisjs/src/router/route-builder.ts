import type {
  Handler,
  Request,
  Response,
  HookError,
  HookResponse,
  RouteSchema,
  ExisFile,
} from '../types'
import type { App } from '../server/app'
import { logger } from '../logger'

/**
 * The execution context passed to every route handler.
 * It provides fully-typed, structured access to the request's properties and the ExisJS app.
 *
 * @example
 * async handle(ctx) {
 *   const { body, query, req, res, app, file, fields } = ctx
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
  file?: ExisFile
  files?: ExisFile[] | Record<string, ExisFile[]>
  fields?: Record<string, any>
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

/**
 * Extracts route parameter names from a path string literal (e.g. '/users/:id/posts/:postId' -> { id: string; postId: string }).
 */
export type ExtractRouteParams<T extends string> = string extends T
  ? Record<string, string>
  : T extends `${infer _Start}:${infer Param}/${infer Rest}`
    ? Record<Param | keyof ExtractRouteParams<`/${Rest}`>, string>
    : T extends `${infer _Start}:${infer Param}`
      ? Record<Param, string>
      : Record<string, string>

export interface BaseRouteConfig<TContext = Record<string, any>> {
  cors?: any
  middleware?:
    | Handler<any, any, any, any, TContext>[]
    | Handler<any, any, any, any, TContext>
  middlewares?:
    | Handler<any, any, any, any, TContext>[]
    | Handler<any, any, any, any, TContext>
  filters?: any | any[]
  host?: string | string[]
  timeoutMs?: number
  timeout?: number | { ms: number; statusCode?: number; message?: string }
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
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TContext = Record<string, any>,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> => {
    if ('body' in config && config.body) {
      logger.warn(
        `GET route '${path}' defines a body schema, but GET requests cannot have bodies.`
      )
    }
    return { method: 'get', path, ...config } as any
  },

  post: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TContext = Record<string, any>,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'post', path, ...config }) as any,

  put: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TContext = Record<string, any>,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'put', path, ...config }) as any,

  delete: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TContext = Record<string, any>,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'delete', path, ...config }) as any,

  patch: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TContext = Record<string, any>,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'patch', path, ...config }) as any,

  options: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TContext = Record<string, any>,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'options', path, ...config }) as any,

  head: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TContext = Record<string, any>,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'head', path, ...config }) as any,

  connect: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TContext = Record<string, any>,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'connect', path, ...config }) as any,

  trace: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TContext = Record<string, any>,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'trace', path, ...config }) as any,

  query: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TContext = Record<string, any>,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'query', path, ...config }) as any,

  all: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TContext = Record<string, any>,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext>
  ): RouteDefinition<B, Q, P, TContext> =>
    ({ method: 'all', path, ...config }) as any,
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
  middleware?: Handler[] | Handler
  middlewares?: Handler[] | Handler
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
      get: <
        TPath extends string = string,
        B = any,
        Q = any,
        P = ExtractRouteParams<TPath>,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      post: <
        TPath extends string = string,
        B = any,
        Q = any,
        P = ExtractRouteParams<TPath>,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      put: <
        TPath extends string = string,
        B = any,
        Q = any,
        P = ExtractRouteParams<TPath>,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      patch: <
        TPath extends string = string,
        B = any,
        Q = any,
        P = ExtractRouteParams<TPath>,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      delete: <
        TPath extends string = string,
        B = any,
        Q = any,
        P = ExtractRouteParams<TPath>,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
      all: <
        TPath extends string = string,
        B = any,
        Q = any,
        P = ExtractRouteParams<TPath>,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext>
      ) => RouteDefinition<B, Q, P, TContext>
    },
    controller: <T extends ControllerConfig>(
      config: T
    ): T & { __isController: true } => controller(config),
  }
}

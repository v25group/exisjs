import type {
  Handler,
  Request,
  Response,
  HookError,
  HookResponse,
  RouteSchema,
  ExisFile,
  ExtractContextFromMiddlewares,
} from '../types'
import type { App } from '../server/app'
import { logger } from '../logger'

/**
 * Creates a strongly typed middleware that injects context into downstream routes or boundaries.
 *
 * @example
 * const authenticate = defineMiddleware<AuthContext>(async (req, res, next) => {
 *   req.user = { id: '123', role: 'admin' }
 *   next()
 * })
 */
export function defineMiddleware<TContext = Record<string, any>>(
  fn: (
    req: Request<any, any, any, TContext>,
    res: Response,
    next: import('../types').NextFunction
  ) => any | Promise<any>
): Handler<any, any, any, any, TContext> {
  return fn as Handler<any, any, any, any, TContext>
}

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
  TReturn = any,
> = BaseRouteConfig<TContext> &
  RouteSchema<B, Q, P, any, TContext> & {
    handle: (ctx: SuperContext<B, Q, P, TContext>) => TReturn | Promise<TReturn>
  }

/**
 * The final built route configuration object.
 */
export type RouteDefinition<
  B = any,
  Q = any,
  P = any,
  TContext = Record<string, any>,
  TReturn = any,
> = RouteConfig<B, Q, P, TContext, TReturn> & {
  method: string
  path: string
  readonly __type?: {
    body: B
    query: Q
    params: P
    return: TReturn
  }
}

/**
 * Defines a new HTTP route with schema validation and a supercharged execution context.
 */
export const route = {
  /**
   * Defines a GET route.
   */
  get: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TMid = undefined,
    TContext = TMid extends undefined
      ? Record<string, any>
      : ExtractContextFromMiddlewares<TMid>,
    TReturn = any,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext, TReturn> & {
      middleware?: TMid
      middlewares?: TMid
    }
  ): RouteDefinition<B, Q, P, TContext, TReturn> => {
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
    TMid = undefined,
    TContext = TMid extends undefined
      ? Record<string, any>
      : ExtractContextFromMiddlewares<TMid>,
    TReturn = any,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext, TReturn> & {
      middleware?: TMid
      middlewares?: TMid
    }
  ): RouteDefinition<B, Q, P, TContext, TReturn> =>
    ({ method: 'post', path, ...config }) as any,

  put: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TMid = undefined,
    TContext = TMid extends undefined
      ? Record<string, any>
      : ExtractContextFromMiddlewares<TMid>,
    TReturn = any,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext, TReturn> & {
      middleware?: TMid
      middlewares?: TMid
    }
  ): RouteDefinition<B, Q, P, TContext, TReturn> =>
    ({ method: 'put', path, ...config }) as any,

  delete: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TMid = undefined,
    TContext = TMid extends undefined
      ? Record<string, any>
      : ExtractContextFromMiddlewares<TMid>,
    TReturn = any,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext, TReturn> & {
      middleware?: TMid
      middlewares?: TMid
    }
  ): RouteDefinition<B, Q, P, TContext, TReturn> =>
    ({ method: 'delete', path, ...config }) as any,

  patch: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TMid = undefined,
    TContext = TMid extends undefined
      ? Record<string, any>
      : ExtractContextFromMiddlewares<TMid>,
    TReturn = any,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext, TReturn> & {
      middleware?: TMid
      middlewares?: TMid
    }
  ): RouteDefinition<B, Q, P, TContext, TReturn> =>
    ({ method: 'patch', path, ...config }) as any,

  options: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TMid = undefined,
    TContext = TMid extends undefined
      ? Record<string, any>
      : ExtractContextFromMiddlewares<TMid>,
    TReturn = any,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext, TReturn> & {
      middleware?: TMid
      middlewares?: TMid
    }
  ): RouteDefinition<B, Q, P, TContext, TReturn> =>
    ({ method: 'options', path, ...config }) as any,

  head: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TMid = undefined,
    TContext = TMid extends undefined
      ? Record<string, any>
      : ExtractContextFromMiddlewares<TMid>,
    TReturn = any,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext, TReturn> & {
      middleware?: TMid
      middlewares?: TMid
    }
  ): RouteDefinition<B, Q, P, TContext, TReturn> =>
    ({ method: 'head', path, ...config }) as any,

  connect: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TMid = undefined,
    TContext = TMid extends undefined
      ? Record<string, any>
      : ExtractContextFromMiddlewares<TMid>,
    TReturn = any,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext, TReturn> & {
      middleware?: TMid
      middlewares?: TMid
    }
  ): RouteDefinition<B, Q, P, TContext, TReturn> =>
    ({ method: 'connect', path, ...config }) as any,

  trace: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TMid = undefined,
    TContext = TMid extends undefined
      ? Record<string, any>
      : ExtractContextFromMiddlewares<TMid>,
    TReturn = any,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext, TReturn> & {
      middleware?: TMid
      middlewares?: TMid
    }
  ): RouteDefinition<B, Q, P, TContext, TReturn> =>
    ({ method: 'trace', path, ...config }) as any,

  query: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TMid = undefined,
    TContext = TMid extends undefined
      ? Record<string, any>
      : ExtractContextFromMiddlewares<TMid>,
    TReturn = any,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext, TReturn> & {
      middleware?: TMid
      middlewares?: TMid
    }
  ): RouteDefinition<B, Q, P, TContext, TReturn> =>
    ({ method: 'query', path, ...config }) as any,

  all: <
    TPath extends string = string,
    B = unknown,
    Q = Record<string, string>,
    P = ExtractRouteParams<TPath>,
    TMid = undefined,
    TContext = TMid extends undefined
      ? Record<string, any>
      : ExtractContextFromMiddlewares<TMid>,
    TReturn = any,
  >(
    path: TPath,
    config: RouteConfig<B, Q, P, TContext, TReturn> & {
      middleware?: TMid
      middlewares?: TMid
    }
  ): RouteDefinition<B, Q, P, TContext, TReturn> =>
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
        TReturn = any,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext, TReturn>
      ) => RouteDefinition<B, Q, P, TContext, TReturn>
      post: <
        TPath extends string = string,
        B = any,
        Q = any,
        P = ExtractRouteParams<TPath>,
        TReturn = any,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext, TReturn>
      ) => RouteDefinition<B, Q, P, TContext, TReturn>
      put: <
        TPath extends string = string,
        B = any,
        Q = any,
        P = ExtractRouteParams<TPath>,
        TReturn = any,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext, TReturn>
      ) => RouteDefinition<B, Q, P, TContext, TReturn>
      patch: <
        TPath extends string = string,
        B = any,
        Q = any,
        P = ExtractRouteParams<TPath>,
        TReturn = any,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext, TReturn>
      ) => RouteDefinition<B, Q, P, TContext, TReturn>
      delete: <
        TPath extends string = string,
        B = any,
        Q = any,
        P = ExtractRouteParams<TPath>,
        TReturn = any,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext, TReturn>
      ) => RouteDefinition<B, Q, P, TContext, TReturn>
      all: <
        TPath extends string = string,
        B = any,
        Q = any,
        P = ExtractRouteParams<TPath>,
        TReturn = any,
      >(
        path: TPath,
        config: RouteConfig<B, Q, P, TContext, TReturn>
      ) => RouteDefinition<B, Q, P, TContext, TReturn>
    },
    controller: <T extends ControllerConfig>(
      config: T
    ): T & { __isController: true } => controller(config),
  }
}

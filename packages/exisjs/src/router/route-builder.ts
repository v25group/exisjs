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
 * @template TContext The custom request context type produced by this middleware
 * @param fn Middleware function receiving `(req, res, next)`
 * @returns Strongly typed middleware handler
 *
 * @example
 * ```ts
 * interface AuthContext {
 *   user: { id: string; role: string }
 * }
 *
 * const authenticate = defineMiddleware<AuthContext>(async (req, res, next) => {
 *   req.user = { id: '123', role: 'admin' }
 *   next()
 * })
 * ```
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
 * @template B Parsed request body type
 * @template Q Parsed query string type
 * @template P Parsed route params type
 * @template TContext Custom injected context type
 *
 * @example
 * ```ts
 * export default controller({
 *   getUser: route.get('/:id', {
 *     async handle({ params, req, res, resolve }) {
 *       const userService = resolve(UserService)
 *       return userService.findById(params.id)
 *     }
 *   })
 * })
 * ```
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
  guards?: any | any[]
  interceptors?: any | any[]
  filters?: any | any[]
  pipes?: any | any[]
  roles?: string | string[]
  permissions?: string | string[]
  public?: boolean
  isPublic?: boolean
  host?: string | string[]
  timeoutMs?: number
  timeout?: number | { ms: number; statusCode?: number; message?: string }
  redirect?: string | { url: string; statusCode?: number }
  httpCode?: number
  headers?: Record<string, string>
  upload?: any
  summary?: string
  description?: string
  tags?: string[]
  operationId?: string
  deprecated?: boolean
  responses?: Record<number, any>
  response?: any
  returns?: any
  security?: any[]
  excludeFromDocs?: boolean
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
 * The validated input a route's handler receives: `{ body, query, params }`.
 * Use it to type service methods from the route definition instead of
 * declaring the same shape twice.
 *
 * @example
 * ```ts
 * export const createUser = route.post('/', { body: CreateUserSchema, handle })
 * type CreateUserInput = InferRouteInput<typeof createUser>['body']
 * ```
 */
export type InferRouteInput<R> = R extends {
  readonly __type?: { body: infer B; query: infer Q; params: infer P }
}
  ? { body: B; query: Q; params: P }
  : never

/** The value a route's handler resolves to (its response payload). */
export type InferRouteOutput<R> = R extends {
  readonly __type?: { return: infer T }
}
  ? Awaited<T>
  : never

/**
 * Declarative route builder with schema validation, typed parameters, and supercharged context.
 */
export const route = {
  /**
   * Defines an HTTP GET route definition.
   *
   * @param path The route URL path (e.g. `'/'` or `'/:id'`)
   * @param config Route configuration with query/params schemas, middleware, and handler
   * @returns Strongly typed `RouteDefinition`
   *
   * @example
   * ```ts
   * import { controller, route } from 'exisjs/router'
   * import { tex } from 'exisjs/validator'
   *
   * export default controller({
   *   getUser: route.get('/:id', {
   *     params: { id: tex.string() },
   *     async handle({ params }) {
   *       return { id: params.id, name: 'Alice' }
   *     }
   *   })
   * })
   * ```
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

  /**
   * Defines an HTTP POST route definition.
   *
   * @param path The route URL path (e.g. `'/'` or `'/submit'`)
   * @param config Route configuration with body schema, middleware, and handler
   * @returns Strongly typed `RouteDefinition`
   *
   * @example
   * ```ts
   * import { controller, route } from 'exisjs/router'
   * import { tex } from 'exisjs/validator'
   *
   * export default controller({
   *   createUser: route.post('/', {
   *     body: tex.object({
   *       email: tex.email(),
   *       password: tex.password({ min: 8 })
   *     }),
   *     async handle({ body, res }) {
   *       res.status(201)
   *       return { email: body.email, created: true }
   *     }
   *   })
   * })
   * ```
   */
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

  /**
   * Defines an HTTP PUT route definition.
   *
   * @param path The route URL path (e.g. `'/:id'`)
   * @param config Route configuration with body/params schemas and handler
   * @returns Strongly typed `RouteDefinition`
   *
   * @example
   * ```ts
   * import { controller, route } from 'exisjs/router'
   * import { tex } from 'exisjs/validator'
   *
   * export default controller({
   *   updateUser: route.put('/:id', {
   *     body: tex.object({ name: tex.string() }),
   *     async handle({ params, body }) {
   *       return { id: params.id, name: body.name }
   *     }
   *   })
   * })
   * ```
   */
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

  /**
   * Defines an HTTP DELETE route definition.
   *
   * @param path The route URL path (e.g. `'/:id'`)
   * @param config Route configuration with params schema and handler
   * @returns Strongly typed `RouteDefinition`
   *
   * @example
   * ```ts
   * import { controller, route } from 'exisjs/router'
   *
   * export default controller({
   *   deleteUser: route.delete('/:id', {
   *     async handle({ params }) {
   *       return { deleted: params.id }
   *     }
   *   })
   * })
   * ```
   */
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

  /**
   * Defines an HTTP PATCH route definition.
   *
   * @param path The route URL path (e.g. `'/:id'`)
   * @param config Route configuration with partial body schema and handler
   * @returns Strongly typed `RouteDefinition`
   *
   * @example
   * ```ts
   * import { controller, route } from 'exisjs/router'
   * import { tex } from 'exisjs/validator'
   *
   * export default controller({
   *   patchUser: route.patch('/:id', {
   *     body: tex.object({ status: tex.enum(['active', 'disabled']) }),
   *     async handle({ params, body }) {
   *       return { id: params.id, status: body.status }
   *     }
   *   })
   * })
   * ```
   */
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

  /**
   * Defines an HTTP OPTIONS route definition.
   */
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

  /**
   * Defines an HTTP HEAD route definition.
   */
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

  /**
   * Defines an HTTP CONNECT route definition.
   */
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

  /**
   * Defines an HTTP TRACE route definition.
   */
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

  /**
   * Defines a QUERY route definition.
   */
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

  /**
   * Defines a route matching any HTTP method (GET, POST, PUT, DELETE, PATCH, etc.).
   *
   * @param path The route URL path (e.g. `'*'` or `'/api/*'`)
   * @param config Route configuration and handler
   * @returns Strongly typed `RouteDefinition`
   */
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
 * ```ts
 * import { controller, route } from 'exisjs/router'
 *
 * export default controller({
 *   cors: true,
 *   middleware: [authGuard],
 *   onError: (err, req, res) => { console.error(err) },
 *
 *   myRoute: route.get('/secret', {
 *     async handle() {
 *       return { secret: 'data' }
 *     }
 *   })
 * })
 * ```
 */
export interface ControllerConfig {
  cors?: any
  middleware?: Handler[] | Handler
  middlewares?: Handler[] | Handler
  guards?: any | any[]
  interceptors?: any | any[]
  filters?: any | any[]
  pipes?: any | any[]
  roles?: string | string[]
  permissions?: string | string[]
  public?: boolean
  isPublic?: boolean
  tags?: string[]
  security?: any[]
  excludeFromDocs?: boolean
  onError?: HookError
  onResponse?: HookResponse
  [key: string]: any
}

/**
 * @internal Creates a controller marker. Use `controller(...)` instead.
 */
function _defineController<T extends ControllerConfig>(
  config: T
): T & { __isController: true } {
  return Object.defineProperty(config, '__isController', {
    value: true,
    enumerable: false, // Hide from iteration
  }) as T & { __isController: true }
}

/**
 * @internal Merges multiple controller configs. Use `controller.merge(...)` instead.
 */
function _mergeControllers(
  ...controllers: ControllerConfig[]
): ControllerConfig & { __isController: true } {
  const merged: any = {
    middlewares: [],
    filters: [],
    guards: [],
    interceptors: [],
    pipes: [],
  }

  for (const ctrl of controllers) {
    if (!ctrl) continue
    if (ctrl.cors !== undefined) merged.cors = ctrl.cors
    if (ctrl.public !== undefined) merged.public = ctrl.public
    if (ctrl.isPublic !== undefined) merged.isPublic = ctrl.isPublic
    if (ctrl.tags) {
      merged.tags = [...(merged.tags || []), ...ctrl.tags]
    }
    if (ctrl.roles) {
      const r = Array.isArray(ctrl.roles) ? ctrl.roles : [ctrl.roles]
      merged.roles = [...(merged.roles || []), ...r]
    }
    if (ctrl.permissions) {
      const p = Array.isArray(ctrl.permissions)
        ? ctrl.permissions
        : [ctrl.permissions]
      merged.permissions = [...(merged.permissions || []), ...p]
    }
    const m = ctrl.middleware || ctrl.middlewares
    if (m) {
      merged.middlewares.push(...(Array.isArray(m) ? m : [m]))
    }
    if (ctrl.filters) {
      merged.filters.push(
        ...(Array.isArray(ctrl.filters) ? ctrl.filters : [ctrl.filters])
      )
    }
    if (ctrl.guards) {
      merged.guards.push(
        ...(Array.isArray(ctrl.guards) ? ctrl.guards : [ctrl.guards])
      )
    }
    if (ctrl.interceptors) {
      merged.interceptors.push(
        ...(Array.isArray(ctrl.interceptors)
          ? ctrl.interceptors
          : [ctrl.interceptors])
      )
    }
    if (ctrl.pipes) {
      merged.pipes.push(
        ...(Array.isArray(ctrl.pipes) ? ctrl.pipes : [ctrl.pipes])
      )
    }
    if (ctrl.onError) merged.onError = ctrl.onError
    if (ctrl.onResponse) merged.onResponse = ctrl.onResponse

    for (const [key, val] of Object.entries(ctrl)) {
      if (
        [
          'cors',
          'middleware',
          'middlewares',
          'filters',
          'guards',
          'interceptors',
          'pipes',
          'roles',
          'permissions',
          'public',
          'isPublic',
          'tags',
          'security',
          'excludeFromDocs',
          'onError',
          'onResponse',
          '__isController',
        ].includes(key)
      ) {
        continue
      }
      merged[key] = val
    }
  }

  return _defineController(merged)
}

/**
 * @internal Extends a base controller with overrides. Use `controller.extend(...)` instead.
 */
function _extendController(
  base: ControllerConfig,
  overrides: ControllerConfig
): ControllerConfig & { __isController: true } {
  return _mergeControllers(base, overrides)
}

export interface ControllerFactory {
  /**
   * Creates a functional route controller. Binds routes together with shared middleware,
   * guards, interceptors, pipes, and error handlers.
   *
   * @param config Controller configuration containing route definitions and shared settings
   * @returns Fully compiled functional controller
   *
   * @example
   * ```ts
   * import { controller, route } from 'exisjs/router'
   * import { tex } from 'exisjs/validator'
   *
   * export default controller({
   *   cors: true,
   *   tags: ['Users'],
   *
   *   list: route.get('/users', {
   *     summary: 'Get all users',
   *     async handle() {
   *       return { users: ['Alice', 'Bob'] }
   *     },
   *   }),
   *
   *   create: route.post('/users', {
   *     summary: 'Create a new user',
   *     body: tex.object({
   *       name: tex.string({ min: 2 }),
   *       email: tex.email(),
   *     }),
   *     async handle({ body, res }) {
   *       res.status(201)
   *       return { created: true, user: body }
   *     },
   *   }),
   * })
   * ```
   */
  <T extends ControllerConfig>(config: T): T & { __isController: true }

  /**
   * Merges multiple functional controllers into one unified controller definition.
   * Ideal for splitting large `route.ts` files into organized sub-modules.
   *
   * @param controllers Controller configurations to combine
   * @returns Merged controller definition
   *
   * @example
   * ```ts
   * // src/http/auth/login.ts
   * export const loginRoutes = controller({
   *   login: route.post('/login', {
   *     async handle({ body }) {
   *       return { token: signJwt(body) }
   *     },
   *   }),
   * })
   *
   * // src/http/auth/oauth.ts
   * export const oauthRoutes = controller({
   *   google: route.get('/google', {
   *     async handle() {
   *       return { redirect: googleAuthUrl }
   *     },
   *   }),
   * })
   *
   * // src/http/auth/route.ts
   * import { loginRoutes } from './login'
   * import { oauthRoutes } from './oauth'
   *
   * export default controller.merge(loginRoutes, oauthRoutes)
   * ```
   */
  merge(
    ...controllers: ControllerConfig[]
  ): ControllerConfig & { __isController: true }

  /**
   * Extends a base functional controller with additional or overridden routes.
   * Perfect for reusable CRUD templates in folder-based routing.
   *
   * @param base Base controller to inherit from
   * @param overrides Additional routes or route overrides
   * @returns Extended controller definition
   *
   * @example
   * ```ts
   * // src/shared/crud.ts
   * export function baseCrud(service: any) {
   *   return controller({
   *     list: route.get('/', {
   *       async handle() {
   *         return service.findAll()
   *       },
   *     }),
   *     getById: route.get('/:id', {
   *       async handle({ params }) {
   *         return service.findById(params.id)
   *       },
   *     }),
   *   })
   * }
   *
   * // src/http/products/route.ts  (auto-mounted at /products)
   * import { baseCrud } from '@/shared/crud'
   * import { productsService } from '@/services/products'
   *
   * export default controller.extend(baseCrud(productsService), {
   *   featured: route.get('/featured', {
   *     async handle() {
   *       return productsService.findFeatured()
   *     },
   *   }),
   * })
   * ```
   */
  extend(
    base: ControllerConfig,
    overrides: ControllerConfig
  ): ControllerConfig & { __isController: true }
}

/**
 * The primary controller utility for ExisJS functional routing.
 *
 * - **`controller({ ... })`** — Define a functional route controller
 * - **`controller.merge(...)`** — Combine multiple controllers into one
 * - **`controller.extend(base, overrides)`** — Inherit and override a base controller
 */
export const controller: ControllerFactory = Object.assign(
  function <T extends ControllerConfig>(config: T) {
    return _defineController(config)
  },
  {
    merge: _mergeControllers,
    extend: _extendController,
  }
)

/**
 * Creates a strongly-typed router and controller factory with pre-bound context.
 *
 * @template TContext Global request context type for the router instance
 * @returns Object with typed `route` and `controller` factories
 *
 * @example
 * ```ts
 * interface MyContext {
 *   user: { id: string; role: string }
 * }
 *
 * export const { route, controller } = createRouter<MyContext>()
 * ```
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

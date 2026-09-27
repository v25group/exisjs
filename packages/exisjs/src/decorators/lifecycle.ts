/**
 * Interface defining a method called once during application initialization.
 */
export interface OnInit {
  onInit(): void | Promise<void>
}

/**
 * Interface defining a method called once during application shutdown.
 */
export interface OnDestroy {
  onDestroy(): void | Promise<void>
}

/**
 * Interface defining a method called when the host module is initialized.
 */
export interface OnModuleInit {
  onModuleInit(): void | Promise<void>
}

/**
 * Interface defining a method called when the host module is destroyed.
 */
export interface OnModuleDestroy {
  onModuleDestroy(): void | Promise<void>
}

/**
 * Interface defining a method called after all modules are initialized and app is ready to accept traffic.
 */
export interface OnApplicationBootstrap {
  onApplicationBootstrap(): void | Promise<void>
}

/**
 * Interface defining a method called when application receives termination signal (SIGINT/SIGTERM).
 */
export interface OnApplicationShutdown {
  onApplicationShutdown(signal?: string): void | Promise<void>
}

export interface HttpArgumentsHost {
  getRequest<T = any>(): T
  getResponse<T = any>(): T
  getNext<T = any>(): T
}

export interface ArgumentsHost {
  req: any
  res: any
  next: any
  app?: any
  state?: Record<string, any>
  switchToHttp(): HttpArgumentsHost
  getType?<TContext extends string = string>(): TContext
}

export interface ExecutionContext extends ArgumentsHost {
  getClass<T = any>(): new (...args: any[]) => T
  getHandler(): (...args: any[]) => any
}

export interface CanActivate {
  canActivate(context: ExecutionContext | any): boolean | Promise<boolean>
}

export interface CallHandler<T = any> {
  handle(): Promise<T>
}

export interface Interceptor<T = any, R = any> {
  intercept(
    context: ExecutionContext | any,
    next?: CallHandler<T> | any
  ): Promise<R> | R
}

export type ExisInterceptor = Interceptor
export type NestInterceptor = Interceptor

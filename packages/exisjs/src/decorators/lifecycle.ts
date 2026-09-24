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

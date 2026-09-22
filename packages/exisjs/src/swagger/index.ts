import type { App } from '../server/app'
import type { SwaggerConfig } from './types'
import { mountDocumentation } from './mounter'

export * from './types'
export * from './generator'
export * from './ui'
export * from './mounter'
export * from './decorators'

/**
 * Convenience helper to initialize and mount Swagger / OpenAPI documentation on an ExisJS App.
 *
 * @param config Optional Swagger configuration options (title, path, version, tags, etc.)
 * @returns Plugin/middleware function that mounts documentation when invoked
 *
 * @example
 * ```ts
 * import { App } from 'exisjs'
 * import { swagger } from 'exisjs/swagger'
 *
 * const app = new App()
 * swagger({
 *   title: 'My Store API',
 *   version: '2.0.0',
 *   path: '/docs',
 * })(app)
 * ```
 */
export function swagger(config?: SwaggerConfig) {
  return (app: App<any>): void => {
    mountDocumentation(app, config)
  }
}

export const defineSwagger = (config: SwaggerConfig): SwaggerConfig => config
export const docs = swagger
export const defineDocs = defineSwagger

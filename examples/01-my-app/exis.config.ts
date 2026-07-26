import { defineConfig } from 'exisjs/config'
import { PHASE_DEVELOPMENT_SERVER } from 'exisjs/config'

// To show off plugins, we could use defineModule from exisjs/module to create a mock plugin.
import { defineModule } from 'exisjs/module'

/**
 * Mock third-party GraphQL Plugin to demonstrate native plugin ecosystem
 */
const graphql = (options: { endpoint: string }) => defineModule({
  name: 'graphql',
  routes: (app) => {
    app.post(options.endpoint, (req, res) => res.json({ data: 'GraphQL Response' }))
  }
})

/**
 * ExisJS Enterprise Configuration Engine
 * 
 * @see https://exisjs.com/docs/api-reference/config (Mock URL)
 */
export default async (phase: string, { defaultConfig }: any) => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER

  return defineConfig({
    /**
     * Server Options
     */
    port: Number(process.env.PORT) || 4000,
    host: '0.0.0.0',

    /**
     * Global Middlewares natively supported
     */
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
      preflightContinue: true,
    },
    helmet: { enabled: true },
    compression: false,

    /**
     * Advanced Tuning
     */
    queue: {
      driver: 'memory',
      maxConcurrent: 100, // For Backpressure
      maxQueue: 1000
    },
    logger: isDev ? {
      level: 'debug',
      pretty: true
    } : false,

    /**
     * ExisJS Plugin Ecosystem
     * 
     * Native integration with any official or community plugins.
     * Works identically to Vite and Next.js NextConfig plugins.
     */
    plugins: [
      graphql({ endpoint: '/graphql' })
    ]
  })
}

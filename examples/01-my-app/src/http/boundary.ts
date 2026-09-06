import { defineBoundary } from 'exisjs/router'
import { helmet, hpp } from 'exisjs/middleware'

/**
 * Root Boundary (folder-scoped config + request pipeline for the entire application)
 *
 * Boundaries apply configuration to all routes within their directory and subdirectories.
 * This acts as the global security and infrastructure layer.
 */
export const config = defineBoundary({
  // 1. Cross-Origin Resource Sharing (CORS)
  // Configured securely for production
  cors: {
    origin: ['https://myapp.com', /localhost:\d+/],
    credentials: true,
  },

  // 2. Global Headers
  // Injected into every single response automatically
  headers: {
    'X-Powered-By': 'ExisJS',
    'X-Application-Version': '1.0.0',
  },

  // 3. Global Middleware
  // Executes on every incoming request
  middleware: [
    helmet(), // Sets 14+ secure HTTP headers
    hpp(), // Prevents HTTP Parameter Pollution
  ],

  // 4. Exclude Paths
  // Bypass this boundary entirely for specific paths
  exclude: [{ path: '/health', methods: ['GET'] }],

  // 5. Dependency Injection Providers
  // Provide services that controllers in subdirectories can inject
  providers: [
    [
      'ConfigService',
      { useValue: { apiKey: process.env.API_KEY || 'default' } },
    ],
  ],

  // 6. Global Metadata
  // Passed down to all routes and accessible via Context or Interceptors
  metadata: {
    tenant: 'root',
  },

  // 7. Request Timeout
  // Automatically kills requests hanging longer than 10 seconds
  timeout: 10000,
})

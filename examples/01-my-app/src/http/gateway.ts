import { Gateway } from 'exisjs/decorators'
import { helmet, dedupe, xss, hpp, cors } from 'exisjs/middleware'

/**
 * Root Gateway (gatekeeper for the entire application)
 * 
 * Gateways apply configuration to all routes within their directory and subdirectories.
 * This acts as the global security and infrastructure layer.
 */
@Gateway({
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
    'X-Application-Version': '1.0.0'
  },

  // 3. Global Middleware
  // Executes on every incoming request
  middleware: [
    helmet(),  // Sets 14+ secure HTTP headers
    xss(),     // Sanitizes payloads against XSS attacks
    dedupe(),  // Request deduplication for heavy in-flight requests
    hpp(),     // Prevents HTTP Parameter Pollution
  ],

  // 4. Exclude Paths
  // Bypass this gateway entirely for specific paths
  exclude: [
    { path: '/health', method: 'GET' }
  ],

  // 5. Dependency Injection Providers
  // Provide services that controllers in subdirectories can inject
  providers: [
    ['ConfigService', { useValue: { apiKey: process.env.API_KEY || 'default' } }]
  ],

  // 6. Global Metadata
  // Passed down to all routes and accessible via Context or Interceptors
  metadata: {
    tenant: 'root'
  },

  // 7. Request Timeout
  // Automatically kills requests hanging longer than 10 seconds
  timeout: 10000 
})
export default class RootGateway {}

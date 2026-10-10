import { defineBoundary } from 'exisjs/router'
import { hpp } from 'exisjs/middleware'

/**
 * Root boundary: applies to every route under src/http.
 * A boundary.ts in a subfolder adds to this one for the routes below it.
 */
export const config = defineBoundary({
  // Added to every response
  headers: {
    'X-Application-Version': '1.0.0',
  },

  // Runs before every route handler
  middleware: [
    hpp(), // collapses repeated query parameters (?id=1&id=2)
  ],

  // Requests still running after 10 seconds are answered with a timeout error
  timeout: 10_000,
})

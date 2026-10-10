import { defineBoundary } from 'exisjs/router'
import { requireAuth } from '@/middleware/auth'

/**
 * Everything under /users requires a valid token.
 * Putting the check in the boundary protects routes added here later too.
 */
export const config = defineBoundary({
  middleware: [requireAuth],
})

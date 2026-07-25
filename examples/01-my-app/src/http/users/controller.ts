import type { Request, Response } from 'exisjs/router'
import { CircuitBreaker } from 'exisjs/circuit-breaker'
import { inject } from 'exisjs/di'
import { UserParamsSchema } from './schema'
import type { UsersService } from './service'

// Mock database
const users = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' }
]

// Mock circuit breaker for an unstable external API
const profileBreaker = new CircuitBreaker({
  failureThreshold: 3,
  resetTimeoutMs: 5000
})

export const getUsers = (req: Request, res: Response) => {
  const logger = inject<{ log: (m: string) => void }>('LoggerService')
  const dbUrl = inject<string>('DATABASE_URL')
  const usersService = inject<UsersService>('UsersService')
  
  logger.log(`Fetching all users from ${dbUrl}`)
  const welcomeMsg = usersService.getWelcomeMessage('Admin')
  
  return res.json({ welcomeMsg, users })
}

export const getUserById = async (req: Request<any, any, { id: number }>, res: Response) => {
  const user = users.find(u => u.id === req.params.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  
  let profile = null
  try {
    profile = await profileBreaker.fire(async () => {
      if (Math.random() < 0.3) throw new Error('External service failed')
      return { bio: 'This is a bio from external service' }
    })
  } catch (e) {
    // Fallback if breaker is OPEN or fails
    profile = { bio: 'Bio unavailable' }
  }
  
  return res.json({ ...user, profile })
}

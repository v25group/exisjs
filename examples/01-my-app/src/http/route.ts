import { controller, route, defineMiddleware } from 'exisjs/router'

// 1. Define your custom context interface
interface AuthContext {
  user: {
    id: string
    role: 'admin' | 'user'
    email: string
  }
}

// 2. Define the middleware using defineMiddleware<AuthContext>()
const authMiddleware = defineMiddleware<AuthContext>((req, _res, next) => {
  req.user = {
    id: 'usr_9876',
    role: 'admin',
    email: 'alex@example.com',
  }
  next()
})

// 3. Standard controller and route — zero router factories or extra boilerplate!
export default controller({
  welcome: route.get('/', {
    handle() {
      return { message: 'Welcome to ExisJS!' }
    },
  }),

  slow: route.get('/slow', {
    async handle({ res }) {
      console.log('[Slow Request]: Processing in-flight request (2s)...')
      await new Promise((r) => setTimeout(r, 2000))
      return res.json({ status: 'completed' })
    },
  }),

  profile: route.get('/profile', {
    middlewares: [authMiddleware],
    handle({ req, res }) {
      // ✨ req.user is automatically inferred directly from middlewares: [authMiddleware]!
      return res.json({
        success: true,
        userId: req.user.id,
        role: req.user.role,
        email: req.user.email,
      })
    },
  }),
})

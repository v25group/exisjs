import { defineGateway } from 'exisjs/router'
import { cors, helmet, dedupe, xss, csrf, hpp } from 'exisjs/middleware'

export default defineGateway({
  // Global middleware applied to all routes (Auth, Users, Posts, etc)
  middleware: [
    helmet(),
    cors({ origin: '*' }),
    xss(),
    dedupe(),
    hpp(),
    // csrf({ cookieOptions: { httpOnly: true } }) // Commented out for easier Postman testing
  ],
})

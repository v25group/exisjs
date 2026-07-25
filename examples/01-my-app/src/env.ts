import { v } from 'exisjs/validator'

export const env = v.env(v.object({
  PORT: v.string().transform(Number),
  NODE_ENV: v.string().default('development'),
  JWT_SECRET: v.string(),
  REDIS_URL: v.string().optional()
}))

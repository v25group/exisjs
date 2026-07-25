import { v } from 'exisjs/validator'

export const env = v.env(v.object({
  PORT: v.string().optional(),
  NODE_ENV: v.enum(['development', 'production', 'test']).optional(),
  CORS_ORIGIN: v.string().optional(),
}))

import { tex } from 'exisjs/validator'

export const env = tex.object({
  PORT: tex.string({ optional: true }),
  NODE_ENV: tex.enum(['development', 'production', 'test'], { optional: true }),
  CORS_ORIGIN: tex.string({ optional: true }),
}).parse(process.env)

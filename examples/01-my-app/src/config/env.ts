import { tex } from 'exisjs/validator'

export const env = tex.object({
  PORT: tex.number({ coerce: true, optional: true }),
  NODE_ENV: tex.string({ optional: true }),
  JWT_SECRET: tex.string(),
  REDIS_URL: tex.string({ optional: true })
}).parse(process.env)

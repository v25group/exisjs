import { tex } from 'exisjs/validator'

export const env = tex
  .env({
    PORT: tex.number({ default: 4000 }),
    NODE_ENV: tex.enum(['development', 'production', 'test'] as const, {
      default: 'development',
    }),
    CORS_ORIGIN: tex.string({ optional: true }),
  })
  .parse(process.env)

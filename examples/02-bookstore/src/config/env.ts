import { tex } from 'exisjs/validator'

// Validated once at startup: the app refuses to boot with a missing or
// malformed variable instead of failing later on the first request.
export const env = tex
  .env({
    PORT: tex.number({ default: 4000 }),
    NODE_ENV: tex.enum(['development', 'production', 'test'], {
      default: 'development',
    }),
    MONGODB_URI: tex.string({ min: 10 }),
    JWT_SECRET: tex.string({ min: 16 }),
  })
  .parse(process.env)

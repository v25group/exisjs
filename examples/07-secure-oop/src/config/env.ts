import { tex } from 'exisjs/validator'

export const env = tex
  .env({
    MONGODB_URI: tex.string({ default: 'mongodb://localhost:27017/exis_secure' }),
    CSRF_SECRET: tex.string({
      default: 'development-only-secret-change-in-production',
    }),
    ADMIN_EMAIL: tex.string({ default: 'admin@example.com' }),
    ADMIN_PASSWORD: tex.string({ default: 'correct-horse-battery-staple' }),
  })
  .parse(process.env)

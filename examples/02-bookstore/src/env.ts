import { v } from 'exisjs/validator'

export const env = v.env(
  v.object({
    PORT: v.string().transform(Number).default(3000),
    NODE_ENV: v.string().default('development'),
    MONGODB_URI: v.string(),
    JWT_SECRET: v.string(),
    CLOUDINARY_CLOUD_NAME: v.string(),
    CLOUDINARY_API_KEY: v.string(),
    CLOUDINARY_API_SECRET: v.string(),
  })
)

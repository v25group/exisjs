import { tex } from 'exisjs/validator'

export const env = tex.object({
  PORT: tex.number({ coerce: true, optional: true }),
  NODE_ENV: tex.string({ optional: true }),
  MONGODB_URI: tex.string(),
  JWT_SECRET: tex.string(),
  CLOUDINARY_CLOUD_NAME: tex.string(),
  CLOUDINARY_API_KEY: tex.string(),
  CLOUDINARY_API_SECRET: tex.string(),
}).parse(process.env)

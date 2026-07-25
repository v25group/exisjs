import type { UserDocument } from '@/models/User'

declare module 'exisjs/router' {
  interface Request {
    user?: UserDocument
  }
}

import type { ResolveSchema } from 'exisjs/validator'
import { tex } from 'exisjs/validator'

export const createUserSchema = tex.object({
  name: tex.string({ min: 1 }),
  email: tex.email(),
  password: tex.string({ min: 8 }),
})

export const userParamsSchema = tex.object({
  id: tex.string(),
})

export type CreateUserDto = ResolveSchema<typeof createUserSchema>

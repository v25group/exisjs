import { v } from 'exisjs/validator'
import type { Infer } from 'exisjs/validator'

export const UserParamsSchema = v.object({
  id: v.number().transform(Number)
})

export type UserParams = Infer<typeof UserParamsSchema>

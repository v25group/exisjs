import { tex } from 'exisjs/validator'
import type { Infer } from 'exisjs/validator'

export const UserParamsSchema = tex.object({
  id: tex.number({ coerce: true })
})

export type UserParams = Infer<typeof UserParamsSchema>

import { tex } from 'exisjs/validator'
import type { Infer } from 'exisjs/validator'

// Path params arrive as strings; coerce turns "42" into 42
export const UserParamsSchema = tex.object({
  id: tex.number({ coerce: true, min: 1 }),
})

export type UserParams = Infer<typeof UserParamsSchema>

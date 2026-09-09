import { tex } from 'exisjs/validator'
import type { ResolveSchema } from 'exisjs/validator'

export const BroadcastSchema = tex.object({
  message: tex.string({ min: 1, max: 200 }),
})

export type BroadcastDto = ResolveSchema<typeof BroadcastSchema>

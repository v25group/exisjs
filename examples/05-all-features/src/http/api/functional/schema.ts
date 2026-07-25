import { v } from 'exisjs/validator'

export const UserParamsSchema = v.object({ id: v.string() })
export const UserBatchSchema = v.object({ ids: v.array(v.string()) })

import { tex } from 'exisjs/validator'

export const UserParamsSchema = tex.object({ id: tex.string() })
export const UserBatchSchema = tex.object({ ids: tex.array(tex.string()) })

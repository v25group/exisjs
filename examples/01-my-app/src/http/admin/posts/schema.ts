import { v } from 'exisjs/validator'

export const CreateAdminPostsSchema = v.object({
  name: v.string()
})

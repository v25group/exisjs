import { tex } from 'exisjs/validator'

export const CreateAdminPostsSchema = tex.object({
  name: tex.string()
})

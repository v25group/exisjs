import { tex } from 'exisjs/validator'

export const noteBody = tex.object({
  title: tex.string({ min: 1, max: 120 }),
  body: tex.string({ max: 5000 }),
})
export const noteParams = tex.object({ id: tex.objectId() })
export const searchQuery = tex.object({ q: tex.string({ min: 1, max: 100 }) })

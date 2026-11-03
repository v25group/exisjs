import { tex } from 'exisjs/validator'

export const registerBody = tex.object({
  email: tex.email({ toLowerCase: true }),
  name: tex.string({ min: 1, max: 80 }),
  password: tex.string({ min: 10, max: 200 }),
})

export const loginBody = tex.object({
  email: tex.email({ toLowerCase: true }),
  password: tex.string({ min: 1, max: 200 }),
})

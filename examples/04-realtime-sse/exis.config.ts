import { defineConfig } from 'exisjs/config'

export default defineConfig({
  port: 4004,
  cors: {
    origin: '*',
    credentials: true,
  },
})

import { defineBoundary } from 'exisjs/router'

export const config = defineBoundary({
  headers: {
    'X-Exis-Realtime': 'active',
  },
  cors: {
    origin: '*',
    credentials: true,
  },
})

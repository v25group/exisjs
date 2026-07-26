import { controller, route } from 'exisjs/router'
import crypto from 'node:crypto'

export default controller({
  heavy: route.get('/', {
    async handle({ res }) {
      // Generate a heavy crypto hash synchronously to completely block the worker's event loop.
      // 100,000 iterations is enough to simulate a very heavy database or crypto operation.
      crypto.pbkdf2Sync('password123', 'salt', 100_000, 64, 'sha512')

      // Return the specific Process ID that handled this request
      return {
        success: true,
        workerPid: process.pid,
        message: 'Heavy CPU task completed',
      }
    },
  }),
})

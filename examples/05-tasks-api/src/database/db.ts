// Database lifecycle
//
// Register your client once and ExisJS connects it at startup (a failed
// connection stops the boot), reports it in health checks, and disconnects it
// once on shutdown, after in-flight requests have finished.
//
// import { registerDatabase } from 'exisjs/database'
// import { pool } from './pool' // pg, Prisma, Drizzle, Mongoose...
//
// registerDatabase({
//   name: 'main',
//   connect: () => pool.connect(),
//   disconnect: () => pool.end(),
//   isHealthy: async () => (await pool.query('select 1')).rowCount === 1,
// })
//
// Then import this file from src/http/server so it runs at startup.

export {}

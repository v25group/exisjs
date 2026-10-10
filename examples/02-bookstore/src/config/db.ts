import mongoose from 'mongoose'
import { registerDatabase, mongoPoolOptions } from 'exisjs/database'
import { env } from './env'

// Registering the database is all that is needed: ExisJS connects it at
// startup (a failed connection stops the boot), reports it in health checks,
// and disconnects it once, after in-flight requests finish, on shutdown.
// Do not also call connect/disconnect from onStart/onClose.
registerDatabase({
  name: 'mongodb',
  connect: async () => {
    await mongoose.connect(env.MONGODB_URI, mongoPoolOptions())
  },
  disconnect: () => mongoose.disconnect(),
  isHealthy: () => mongoose.connection.readyState === 1,
})

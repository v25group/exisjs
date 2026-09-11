import mongoose from 'mongoose'
import { registerDatabase, mongoPoolOptions } from 'exisjs/database'

export async function connectDB(uri?: string): Promise<void> {
  const mongoUri =
    uri || process.env.MONGO_URI || 'mongodb://localhost:27017/bookstore'

  try {
    await mongoose.connect(mongoUri, mongoPoolOptions())
    console.log(`[MongoDB] Connected successfully to ${mongoUri}`)
  } catch (error) {
    console.error('[MongoDB] Connection error:', error)
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect()
}

registerDatabase({
  name: 'mongodb',
  connect: connectDB,
  disconnect: disconnectDB,
  isHealthy: () => mongoose.connection.readyState === 1,
})

import mongoose from 'mongoose'

export async function connectDB(uri?: string): Promise<void> {
  const mongoUri =
    uri || process.env.MONGO_URI || 'mongodb://localhost:27017/bookstore'

  try {
    await mongoose.connect(mongoUri)
    console.log(`[MongoDB] Connected successfully to ${mongoUri}`)
  } catch (error) {
    console.error('[MongoDB] Connection error:', error)
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect()
}

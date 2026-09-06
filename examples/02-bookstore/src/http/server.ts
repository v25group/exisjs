import { Server } from 'exisjs/decorators'
import type { App } from 'exisjs'
import { connectDB, disconnectDB } from '@/config/db'

@Server()
export default class RootServer {
  async onStart(app: App) {
    // 1. Connect to local database
    await connectDB()

    app.log.info('Server successfully started')
  }

  async onClose(app: App) {
    await disconnectDB()
  }
}

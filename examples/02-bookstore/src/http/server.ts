import { Server } from 'exisjs/decorators'
import type { App } from 'exisjs'
import '@/config/db' // registers MongoDB with the framework lifecycle

@Server()
export default class RootServer {
  async onStart(app: App) {
    app.log.info('Bookstore API started')
  }

  async onClose(app: App) {
    // Release anything ExisJS does not manage. The registered database is
    // disconnected automatically.
    app.log.info('Bookstore API shutting down')
  }
}

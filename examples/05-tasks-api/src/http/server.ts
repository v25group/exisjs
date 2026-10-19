import { exis } from 'exisjs'

export default exis({
  async onStart(_app) {
    // Runs once before the server accepts requests: register providers,
    // warm caches, start background workers.
    // Databases: call registerDatabase() (see src/database/db) and ExisJS
    // connects them at startup and disconnects them on shutdown.
  },

  async onClose(_app) {
    // Runs during graceful shutdown: release what ExisJS does not manage
    // (queues, browser sessions, workers). Registered databases are
    // disconnected automatically; do not disconnect them here.
  },
})

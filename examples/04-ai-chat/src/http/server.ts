import { exis } from 'exisjs'

export default exis({
  async onStart(app) {
    // 1. Connect to your database
    // await db.connect()
    
    // 2. Register plugins
    // app.plugin(authPlugin)
    
    // The Exis CLI automatically boots the server and file-system routes
  },
  
  async onClose(app) {
    // Gracefully close database connections here
    // await db.disconnect()
  }
})

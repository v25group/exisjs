import { exis } from 'exisjs'
import { configureMongoose } from 'exisjs/mongoose'

export default exis({
  async onStart(app) {
    // 1. Connect to your database
    configureMongoose({})
    
    // 2. Register plugins and middleware
    // app.use(authMiddleware)
    // app.use(cacheMiddleware)

    app.log.info('Server successfully started')
  }
})

import { controller, route } from 'exisjs/router'
import mongoose from 'mongoose'

export default controller({
  check: route.get('/', {
    handle() {
      const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
      
      return { 
        status: 'ok',
        database: dbStatus,
        uptime: process.uptime()
      }
    }
  })
})

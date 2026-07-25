import { defineJob } from 'exisjs/queue'
import { v } from 'exisjs/validator'

export default defineJob({
  name: 'process-image', // Optional, defaults to file name
  schema: v.object({
    imageId: v.string(),
    resize: v.boolean()
  }),
  handler: async (payload) => {
    // This runs completely off the main thread in a V8 isolate!
    console.log(`[Job Worker Thread] Processing image: ${payload.data.imageId}`)
    
    // Simulate heavy synchronous work (this would block Node.js event loop normally)
    const end = Date.now() + 2000
    while (Date.now() < end) {
      // Blocking...
    }
    
    console.log(`[Job Worker Thread] Finished image: ${payload.data.imageId}`)
  }
})

import { defineLoaders, Dataloader } from 'exisjs/dataloader'
import { getRequest } from 'exisjs/router'

const fakeDb = [
  { id: '1', name: 'Alice', role: 'admin' },
  { id: '2', name: 'Bob', role: 'user' },
  { id: '3', name: 'Charlie', role: 'user' }
]

export const { loaderMiddleware, getLoaders } = defineLoaders({
  user: () => new Dataloader(
    async (keys: readonly string[]) => {
      const req = getRequest()
      console.log(`[UserLoader] Batch fetching users for keys: ${keys.join(', ')} | RequestId: ${req.requestId}`)
      
      const results = keys.map((key) => {
        const user = fakeDb.find(u => u.id === key)
        if (!user) return new Error(`User not found: ${key}`)
        return user
      })
      
      return results
    },
    { maxBatchSize: 100 }
  )
})

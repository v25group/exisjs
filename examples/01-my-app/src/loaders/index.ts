import { defineLoaders, Dataloader } from 'exisjs/dataloader'
import { getRequest } from 'exisjs/router'

// 1. A simulated fake database
const fakeDb = [
  { id: '1', name: 'Alice', privateData: 'secret1' },
  { id: '2', name: 'Bob', privateData: 'secret2' },
  { id: '3', name: 'Charlie', privateData: 'secret3' }
]

// 2. We export the loader registry securely bound to the request context!
export const { loaderMiddleware, getLoaders } = defineLoaders({
  // This factory function is called lazily once per HTTP request,
  // ensuring that cache never leaks across different users.
  user: () => new Dataloader(
    async (keys: readonly string[]) => {
      // PROOF OF VULNERABILITY 1 FIX: Access the active Request!
      const req = getRequest()
      const authToken = req.headers.authorization
      
      console.log(`\n[UserLoader] Batch fetching users for keys: ${keys.join(', ')}`)
      console.log(`[UserLoader] Active User Token: ${authToken || 'none'}`)
      
      const results = keys.map((key) => {
        const user = fakeDb.find(u => u.id === key)
        if (!user) return new Error(`User not found: ${key}`)
        
        // Example: Only return privateData if authenticated
        if (authToken !== 'Bearer my-token') {
          return { id: user.id, name: user.name }
        }
        return user
      })
      
      return results
    },
    { maxBatchSize: 100 }
  )
})

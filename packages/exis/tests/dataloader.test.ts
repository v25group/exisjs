import { App } from '../src/server/app'
import { createServer } from 'node:http'
import { ExisRequest } from '../src/server/request'
import { ExisResponse } from '../src/server/response'

describe('Native Dataloader', () => {
  it('batches concurrent requests for the same key and different keys into a single batch function call', async () => {
    let batchCallCount = 0
    const app = new App().dataloader(
      'users',
      async (keys: readonly number[]) => {
        batchCallCount++
        return keys.map((key) => ({ id: key, name: `User ${key}` }))
      }
    )

    const req = new ExisRequest(
      { url: '/', method: 'GET', headers: {} } as any,
      new ExisResponse({} as any)
    )
    req._dataloaderFns = app._dataloaders

    const userLoader = req.dataloader<number, { id: number; name: string }>(
      'users'
    )

    // Fire 3 requests in parallel
    const [u1a, u2, u1b] = await Promise.all([
      userLoader.load(1),
      userLoader.load(2),
      userLoader.load(1),
    ])

    expect(batchCallCount).toBe(1)
    expect(u1a.id).toBe(1)
    expect(u2.id).toBe(2)
    expect(u1b.id).toBe(1) // from cache
  })

  it('rejects correctly if batch function fails', async () => {
    const app = new App().dataloader('broken', async () => {
      throw new Error('Database down')
    })

    const req = new ExisRequest(
      { url: '/', method: 'GET', headers: {} } as any,
      new ExisResponse({} as any)
    )
    req._dataloaderFns = app._dataloaders

    const loader = req.dataloader<number, any>('broken')

    await expect(loader.load(1)).rejects.toThrow('Database down')
  })

  it('rejects specific keys if batch function returns Error for that key', async () => {
    const app = new App().dataloader(
      'users',
      async (keys: readonly number[]) => {
        return keys.map((key) => {
          if (key === 2) return new Error('User not found')
          return { id: key }
        })
      }
    )

    const req = new ExisRequest(
      { url: '/', method: 'GET', headers: {} } as any,
      new ExisResponse({} as any)
    )
    req._dataloaderFns = app._dataloaders

    const loader = req.dataloader<number, { id: number }>('users')

    const p1 = loader.load(1)
    const p2 = loader.load(2)

    await expect(p1).resolves.toEqual({ id: 1 })
    await expect(p2).rejects.toThrow('User not found')
  })

  it('clears cache manually', async () => {
    let batchCallCount = 0
    const app = new App().dataloader(
      'users',
      async (keys: readonly number[]) => {
        batchCallCount++
        return keys.map((key) => ({ id: key }))
      }
    )

    const req = new ExisRequest(
      { url: '/', method: 'GET', headers: {} } as any,
      new ExisResponse({} as any)
    )
    req._dataloaderFns = app._dataloaders

    const loader = req.dataloader<number, { id: number }>('users')

    await loader.load(1)
    expect(batchCallCount).toBe(1)

    loader.clear(1)
    await loader.load(1)
    expect(batchCallCount).toBe(2)

    await loader.loadMany([1, 2])
    expect(batchCallCount).toBe(3)
  })

  it('provides isolated loaders for different requests', async () => {
    let batchCallCount = 0
    const app = new App().dataloader(
      'users',
      async (keys: readonly number[]) => {
        batchCallCount++
        return keys.map((key) => ({ id: key }))
      }
    )

    const req1 = new ExisRequest(
      { url: '/', method: 'GET', headers: {} } as any,
      new ExisResponse({} as any)
    )
    req1._dataloaderFns = app._dataloaders

    const req2 = new ExisRequest(
      { url: '/', method: 'GET', headers: {} } as any,
      new ExisResponse({} as any)
    )
    req2._dataloaderFns = app._dataloaders

    const loader1 = req1.dataloader<number, { id: number }>('users')
    const loader2 = req2.dataloader<number, { id: number }>('users')

    await loader1.load(1)
    await loader2.load(1)

    // Should be 2 calls because loaders are isolated per request!
    expect(batchCallCount).toBe(2)
  })

  it('supports cacheKeyFn for object keys', async () => {
    let batchCallCount = 0
    const app = new App().dataloader<{ id: number }, { id: number }, string>(
      'users',
      async (keys: readonly {id: number}[]) => {
        batchCallCount++
        return keys.map((key) => ({ id: key.id }))
      },
      {
        cacheKeyFn: (key: any) => String(key.id),
      }
    )

    const req = new ExisRequest(
      { url: '/', method: 'GET', headers: {} } as any,
      new ExisResponse({} as any)
    )
    req._dataloaderFns = app._dataloaders

    const loader = req.dataloader<{ id: number }, { id: number }, string>(
      'users'
    )

    await Promise.all([loader.load({ id: 1 }), loader.load({ id: 1 })])

    expect(batchCallCount).toBe(1)
  })

  it('splits requests when maxBatchSize is exceeded', async () => {
    let batchCallCount = 0
    const app = new App().dataloader(
      'users',
      async (keys: readonly number[]) => {
        batchCallCount++
        return keys.map((key) => ({ id: key }))
      },
      {
        maxBatchSize: 2,
      }
    )

    const req = new ExisRequest(
      { url: '/', method: 'GET', headers: {} } as any,
      new ExisResponse({} as any)
    )
    req._dataloaderFns = app._dataloaders

    const loader = req.dataloader<number, { id: number }>('users')

    await Promise.all([
      loader.load(1),
      loader.load(2),
      loader.load(3),
      loader.load(4),
      loader.load(5),
    ])

    // 5 items with maxBatchSize 2 means 3 batches
    expect(batchCallCount).toBe(3)
  })

  it('supports cache: false', async () => {
    let batchCallCount = 0
    const app = new App().dataloader(
      'users',
      async (keys: readonly number[]) => {
        batchCallCount++
        return keys.map((key) => ({ id: key }))
      },
      {
        cache: false,
      }
    )

    const req = new ExisRequest(
      { url: '/', method: 'GET', headers: {} } as any,
      new ExisResponse({} as any)
    )
    req._dataloaderFns = app._dataloaders

    const loader = req.dataloader<number, { id: number }>('users')

    await Promise.all([loader.load(1), loader.load(1)])

    expect(batchCallCount).toBe(1) // Still batches the same tick

    await loader.load(1)
    expect(batchCallCount).toBe(2) // No cache, so a new call
  })

  it('supports prime() to pre-fill cache', async () => {
    let batchCallCount = 0
    const app = new App().dataloader(
      'users',
      async (keys: readonly number[]) => {
        batchCallCount++
        return keys.map((key) => ({ id: key }))
      }
    )

    const req = new ExisRequest(
      { url: '/', method: 'GET', headers: {} } as any,
      new ExisResponse({} as any)
    )
    req._dataloaderFns = app._dataloaders

    const loader = req.dataloader<number, { id: number }>('users')

    loader.prime(1, { id: 1 })

    const u = await loader.load(1)
    expect(u.id).toBe(1)
    expect(batchCallCount).toBe(0) // Should not call DB
  })
})

import { App } from '../src/server/app'
import { inject } from '../src/di/inject'
import { describe, it, expect } from '../src/testing'

describe('Dependency Injection', () => {
  it('should provide and resolve a value provider globally', () => {
    const app = new App({ asyncContext: true })
    app.provide('API_KEY', { useValue: '12345' })
    expect(app.resolve('API_KEY')).toBe('12345')
  })

  it('should provide and resolve a factory provider globally', () => {
    const app = new App({ asyncContext: true })
    let count = 0
    app.provide('Counter', {
      useFactory: () => {
        count++
        return count
      },
    })

    // Test lazy and cached evaluation
    expect(app.resolve('Counter')).toBe(1)
    expect(app.resolve('Counter')).toBe(1) // should be cached
    expect(count).toBe(1)
  })

  it('should provide and resolve a class provider globally', () => {
    const app = new App({ asyncContext: true })
    class Database {
      url = 'postgres://localhost'
    }

    app.provide('DB', { useClass: Database })

    const db1 = app.resolve<Database>('DB')
    const db2 = app.resolve<Database>('DB')

    expect(db1).toBeInstanceOf(Database)
    expect(db1.url).toBe('postgres://localhost')
    expect(db1).toBe(db2) // should be the same instance
  })

  it('should auto-instantiate a class if provided directly as a token', () => {
    const app = new App({ asyncContext: true })
    class Logger {
      log() {
        return 'logged'
      }
    }

    const logger1 = app.resolve(Logger)
    const logger2 = app.resolve(Logger)

    expect(logger1).toBeInstanceOf(Logger)
    expect(logger1.log()).toBe('logged')
    expect(logger1).toBe(logger2) // cached
  })

  it('should throw if token is not found', () => {
    const app = new App({ asyncContext: true })
    expect(() => app.resolve('UNKNOWN')).toThrow(
      'Provider not found for token: UNKNOWN'
    )
  })

  it('should resolve via inject() inside a request context', async () => {
    const app = new App({ asyncContext: true })
    app.provide('MESSAGE', { useValue: 'Hello from DI!' })

    app.get('/', (req, res) => {
      const message = inject<string>('MESSAGE')
      return res.json({ message })
    })

    const res = await app.inject({ url: '/' })
    expect(res.body).toEqual({ message: 'Hello from DI!' })
  })

  it('should throw if inject() is called outside a request context', () => {
    // There is no active request, so context store is empty
    expect(() => inject('MESSAGE')).toThrow(
      'inject() can only be called inside an active Exis context.'
    )
  })

  it('should support request-scoped providers', async () => {
    const app = new App({ asyncContext: true })

    let singletonInstantiations = 0
    let requestInstantiations = 0

    class SingletonService {
      constructor() {
        singletonInstantiations++
      }
    }

    class RequestService {
      constructor() {
        requestInstantiations++
      }
    }

    app.provide(SingletonService, {
      useClass: SingletonService,
      scope: 'singleton',
    })
    app.provide(RequestService, { useClass: RequestService, scope: 'request' })

    let singletonInstance1: any
    let requestInstance1: any
    let singletonInstance2: any
    let requestInstance2: any

    app.get('/req1', (req, res) => {
      singletonInstance1 = inject(SingletonService)
      requestInstance1 = inject(RequestService)

      // Calling inject multiple times in SAME request should return SAME instance
      expect(inject(RequestService)).toBe(requestInstance1)

      return res.json({ ok: true })
    })

    app.get('/req2', (req, res) => {
      singletonInstance2 = inject(SingletonService)
      requestInstance2 = inject(RequestService)
      return res.json({ ok: true })
    })

    await app.inject({ url: '/req1' })
    await app.inject({ url: '/req2' })

    expect(singletonInstantiations).toBe(1)
    expect(requestInstantiations).toBe(2)
    expect(singletonInstance1).toBe(singletonInstance2)
    expect(requestInstance1).not.toBe(requestInstance2)
  })
})

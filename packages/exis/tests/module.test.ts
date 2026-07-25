import { App } from '../src/server/app'
import { defineModule } from '../src/module/module'
import { inject } from '../src/di/inject'
import { defineGateway } from '../src/router/gateway'

describe('Modular Architecture', () => {
  it('should register standalone module providers and deduplicate imports', async () => {
    const app = new App()

    let dbInitCount = 0
    const DatabaseModule = defineModule({
      name: 'DatabaseModule',
      providers: [['DB_CONN', { useValue: 'postgres://localhost' }]],
      onStart: () => {
        dbInitCount++
      },
    })

    const UsersModule = defineModule({
      name: 'UsersModule',
      imports: [DatabaseModule],
      providers: [['UsersService', { useValue: { getUser: () => 'john' } }]],
    })

    const PostsModule = defineModule({
      name: 'PostsModule',
      imports: [DatabaseModule],
      providers: [['PostsService', { useValue: { getPost: () => 'hello' } }]],
    })

    await app.register(UsersModule)
    await app.register(PostsModule)

    // Verify deduplication (DB module only initializes once)
    expect(dbInitCount).toBe(1)

    // Verify providers are injected globally
    app.get('/', () => {
      const db = inject<string>('DB_CONN')
      const users = inject<{ getUser: () => string }>('UsersService')
      return { db, user: users.getUser() }
    })

    const res = await app.inject({ url: '/' })
    expect(res.body).toEqual({ db: 'postgres://localhost', user: 'john' })
  })

  it('should support defineGateway as a module in file-based routing', async () => {
    const app = new App()

    const DatabaseModule = defineModule({
      name: 'DatabaseModule',
      providers: [['DB_CONN', { useValue: 'mysql://localhost' }]],
    })

    const gateway = defineGateway({
      imports: [DatabaseModule],
      providers: [['LocalService', { useValue: 'local' }]],
    })

    // Simulate file-based router loading the gateway
    if (gateway.imports) {
      for (const mod of gateway.imports) {
        const name = 'plugin' in mod ? mod.plugin.name : mod.name
        if (!app.hasPlugin(name)) await app.register(mod)
      }
    }
    if (gateway.providers) {
      for (const [token, providerConfig] of gateway.providers) {
        app.provide(token, providerConfig)
      }
    }

    app.get('/', () => {
      return {
        db: inject<string>('DB_CONN'),
        local: inject<string>('LocalService'),
      }
    })

    const res = await app.inject({ url: '/' })
    expect(res.body).toEqual({ db: 'mysql://localhost', local: 'local' })
  })
})

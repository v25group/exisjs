import test from 'node:test'
import assert from 'node:assert/strict'
import { App } from '../src/server/app'
import { createTestApp } from '../src/testing'
import { inject, Container } from '../src/di'
import { route } from '../src/router'
import { defineModule } from '../src/module'
import { Module, Controller, Get } from '../src/decorators'

test('Dependency Injection - Custom Providers and inject() Helper', async (t) => {
  await t.test(
    'Container supports useValue, useClass, useFactory (with inject), and useExisting',
    () => {
      const container = new Container()

      class ConfigService {
        public port = 8080
      }

      class LoggerService {
        public logs: string[] = []
        log(msg: string) {
          this.logs.push(msg)
        }
      }

      // 1. useClass
      container.provide(ConfigService, { useClass: ConfigService })

      // 2. useValue
      container.provide({
        provide: 'API_KEY',
        useValue: 'secret-key-123',
      })

      // 3. useFactory with injected dependencies
      container.provide({
        provide: 'DATABASE_CLIENT',
        useFactory: (cfg: ConfigService, apiKey: string) => {
          return {
            connectedPort: cfg.port,
            apiKey,
            query: (sql: string) => `Executed ${sql} with key ${apiKey}`,
          }
        },
        inject: [ConfigService, 'API_KEY'],
      })

      // 4. useExisting alias
      container.provide({
        provide: 'DB_ALIAS',
        useExisting: 'DATABASE_CLIENT',
      })

      const config = container.resolve(ConfigService)
      assert.strictEqual(config.port, 8080)

      const apiKey = container.resolve<string>('API_KEY')
      assert.strictEqual(apiKey, 'secret-key-123')

      const db = container.resolve<any>('DATABASE_CLIENT')
      assert.strictEqual(db.connectedPort, 8080)
      assert.strictEqual(db.apiKey, 'secret-key-123')
      assert.strictEqual(
        db.query('SELECT 1'),
        'Executed SELECT 1 with key secret-key-123'
      )

      const dbAlias = container.resolve<any>('DB_ALIAS')
      assert.strictEqual(dbAlias, db)
    }
  )

  await t.test(
    'App.provide supports both custom provider objects and (token, def) syntax',
    () => {
      const app = new App()

      app.provide({
        provide: 'FEATURE_FLAGS',
        useValue: { beta: true, v2: false },
      })

      app.provide('NOTIFICATION_SERVICE', {
        useValue: {
          send: (to: string) => `Sent to ${to}`,
        },
      })

      const flags = app.resolve<any>('FEATURE_FLAGS')
      assert.deepStrictEqual(flags, { beta: true, v2: false })

      const notifications = app.resolve<any>('NOTIFICATION_SERVICE')
      assert.strictEqual(
        notifications.send('user@example.com'),
        'Sent to user@example.com'
      )
    }
  )

  await t.test(
    'inject() helper works inside functional route handlers and resolves dependencies',
    async () => {
      const app = new App({ asyncContext: true })

      app.provide({
        provide: 'APP_CONFIG',
        useValue: { env: 'production', region: 'us-east-1' },
      })

      app.provide({
        provide: 'METRICS_SERVICE',
        useFactory: (cfg: any) => ({
          track: (event: string) => `Tracked ${event} in ${cfg.region}`,
        }),
        inject: ['APP_CONFIG'],
      })

      app.get('/status', () => {
        const cfg = inject<any>('APP_CONFIG')
        const metrics = inject<any>('METRICS_SERVICE')
        return {
          env: cfg.env,
          metric: metrics.track('health_check'),
        }
      })

      const client = await createTestApp(app)
      const res = await client.get('/status')
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(res.body, {
        env: 'production',
        metric: 'Tracked health_check in us-east-1',
      })
    }
  )

  await t.test(
    'defineModule and @Module register custom providers into container',
    async () => {
      // 1. Functional defineModule
      const analyticsModule = defineModule({
        name: 'AnalyticsModule',
        providers: [
          {
            provide: 'ANALYTICS_KEY',
            useValue: 'analytics-xyz',
          },
          {
            provide: 'ANALYTICS_SERVICE',
            useFactory: (key: string) => ({
              key,
              send: () => 'ok',
            }),
            inject: ['ANALYTICS_KEY'],
          },
        ],
      })

      // 2. OOP Module with controller
      @Controller('/users')
      class UserController {
        @Get('/analytics')
        getAnalytics() {
          const analytics = inject<any>('ANALYTICS_SERVICE')
          return { key: analytics.key }
        }
      }

      @Module({
        imports: [analyticsModule],
        controllers: [UserController],
        providers: [
          {
            provide: 'USER_MODULE_TOKEN',
            useValue: 'user_active',
          },
        ],
      })
      class UserModule {}

      const app = new App({ asyncContext: true })
      await app.register(UserModule)

      const userToken = app.resolve('USER_MODULE_TOKEN')
      assert.strictEqual(userToken, 'user_active')

      const analyticsService = app.resolve<any>('ANALYTICS_SERVICE')
      assert.strictEqual(analyticsService.key, 'analytics-xyz')

      const client = await createTestApp(app)
      const res = await client.get('/users/analytics')
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(res.body, { key: 'analytics-xyz' })
    }
  )

  await t.test(
    'supports transient and request-scoped custom providers',
    async () => {
      let callCount = 0
      const container = new Container()

      container.provide({
        provide: 'TRANSIENT_ID',
        useFactory: () => ++callCount,
        scope: 'transient',
      })

      const id1 = container.resolve('TRANSIENT_ID')
      const id2 = container.resolve('TRANSIENT_ID')
      assert.strictEqual(id1, 1)
      assert.strictEqual(id2, 2)

      const requestCache1 = new Map()
      const requestCache2 = new Map()

      let reqScopedCount = 0
      container.provide({
        provide: 'REQ_SCOPED_SERVICE',
        useFactory: () => ({ id: ++reqScopedCount }),
        scope: 'request',
      })

      const s1 = container.resolve<any>('REQ_SCOPED_SERVICE', requestCache1)
      const s1Again = container.resolve<any>(
        'REQ_SCOPED_SERVICE',
        requestCache1
      )
      assert.strictEqual(s1, s1Again)
      assert.strictEqual(s1.id, 1)

      const s2 = container.resolve<any>('REQ_SCOPED_SERVICE', requestCache2)
      assert.notStrictEqual(s1, s2)
      assert.strictEqual(s2.id, 2)
    }
  )

  await t.test(
    'inject() throws outside request context while app.resolve() works anytime',
    () => {
      const app = new App()
      app.provide({
        provide: 'GLOBAL_CONFIG',
        useValue: { cluster: 'prod-eu' },
      })

      assert.throws(
        () => inject('GLOBAL_CONFIG'),
        /inject\(\) can only be called inside an active Exis context\./
      )

      const resolved = app.resolve<any>('GLOBAL_CONFIG')
      assert.deepStrictEqual(resolved, { cluster: 'prod-eu' })
    }
  )
})

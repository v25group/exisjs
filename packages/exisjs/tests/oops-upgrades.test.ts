import { describe, it, expect, createTestApp } from '../src/testing'
import { App } from '../src/server/app'
import {
  Controller,
  Get,
  Post,
  Body,
  Injectable,
  Permissions,
  Roles,
  Public,
  Cacheable,
  CacheEvict,
  Transactional,
  Profile,
  Catch,
  UseFilters,
  type ExceptionFilter,
  type ArgumentsHost,
  type OnInit,
  type OnDestroy,
} from '../src/decorators'
import { ForbiddenException, NotFoundException } from '../src/error'

describe('ExisJS Enterprise OOP Architecture Upgrades', () => {
  it('enforces @Permissions, @Roles, and @Public decorators on controllers and route methods', async () => {
    @Controller('/admin')
    class AdminController {
      @Get('/public')
      @Public()
      async getPublic() {
        return { status: 'public_ok' }
      }

      @Get('/roles-only')
      @Roles('admin', 'manager')
      async getRolesOnly() {
        return { status: 'roles_ok' }
      }

      @Post('/manage')
      @Permissions('users:write', 'users:delete')
      async manageUsers() {
        return { status: 'permissions_ok' }
      }
    }

    let currentUser: any = undefined

    const app = new App()
    app.use((req: any, _res: any, next: any) => {
      req.user = currentUser
      next()
    })
    app.registerControllers([AdminController])
    const client = createTestApp(app)

    // 1. Public route is accessible without user credentials
    const resPublic = await client.get('/admin/public')
    expect(resPublic.status).toBe(200)
    expect(resPublic.body.status).toBe('public_ok')

    // 2. Roles-only route returns 403 when user does not have required role
    const resRoleFail = await client.get('/admin/roles-only')
    expect(resRoleFail.status).toBe(403)

    // 3. Permissions route succeeds for user with matching permission
    currentUser = {
      role: 'admin',
      permissions: ['users:write'],
      isSuperAdmin: false,
    }

    const resRolePass = await client.get('/admin/roles-only')
    expect(resRolePass.status).toBe(200)

    const resPermPass = await client.post('/admin/manage')
    expect(resPermPass.status).toBe(200)
    expect(resPermPass.body.status).toBe('permissions_ok')
  })

  it('runs OnInit and OnDestroy lifecycle hooks on Injectable services', async () => {
    let initCalled = false
    let destroyCalled = false

    @Injectable()
    class DatabaseService implements OnInit, OnDestroy {
      async onInit() {
        initCalled = true
      }
      async onDestroy() {
        destroyCalled = true
      }
    }

    const app = new App()
    app.provide(DatabaseService, { useClass: DatabaseService })
    app.resolve(DatabaseService) // Instantiate singleton

    await app.container.initLifecycle()
    expect(initCalled).toBe(true)

    await app.container.destroyLifecycle()
    expect(destroyCalled).toBe(true)
  })

  it('caches method return values with @Cacheable and evicts them with @CacheEvict', async () => {
    let queryCount = 0

    @Injectable()
    class UserService {
      @Cacheable({ ttl: 60, key: (id: string) => `user:${id}` })
      async getUser(id: string) {
        queryCount++
        return { id, name: `User ${id}` }
      }

      @CacheEvict({ key: (id: string) => `user:${id}` })
      async updateUser(id: string) {
        return { id, updated: true }
      }
    }

    const service = new UserService()

    // First call executes underlying method
    const u1 = await service.getUser('101')
    expect(u1.name).toBe('User 101')
    expect(queryCount).toBe(1)

    // Second call with same arg hits cache
    const u2 = await service.getUser('101')
    expect(u2.name).toBe('User 101')
    expect(queryCount).toBe(1)

    // Evict cache
    await service.updateUser('101')

    // Third call re-executes query
    const u3 = await service.getUser('101')
    expect(u3.name).toBe('User 101')
    expect(queryCount).toBe(2)
  })

  it('executes database transactions via @Transactional decorator', async () => {
    let committed = false
    let rolledBack = false

    class MockDb {
      async transaction(cb: (tx: any) => Promise<any>) {
        const tx = {
          insert: async () => 'inserted',
        }
        try {
          const result = await cb(tx)
          committed = true
          return result
        } catch (err) {
          rolledBack = true
          throw err
        }
      }
    }

    @Injectable()
    class OrderService {
      public db = new MockDb()

      @Transactional()
      async createOrder(shouldFail: boolean) {
        if (shouldFail) {
          throw new Error('Payment failed')
        }
        return { id: 'order_1' }
      }
    }

    const service = new OrderService()

    const order = await service.createOrder(false)
    expect(order.id).toBe('order_1')
    expect(committed).toBe(true)

    await expect(service.createOrder(true)).rejects.toThrow('Payment failed')
    expect(rolledBack).toBe(true)
  })

  it('profiles execution time with @Profile decorator', async () => {
    let profiledDuration = 0
    let profiledMethod = ''

    @Injectable()
    class ReportService {
      @Profile({
        log: (info) => {
          profiledDuration = info.durationMs
          profiledMethod = info.methodName
        },
      })
      async generate() {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 'report_done'
      }
    }

    const service = new ReportService()
    const result = await service.generate()

    expect(result).toBe('report_done')
    expect(profiledMethod).toBe('generate')
    expect(profiledDuration).toBeGreaterThanOrEqual(5)
  })

  it('catches specific exceptions using @Catch and @UseFilters', async () => {
    @Catch(NotFoundException)
    class NotFoundFilter implements ExceptionFilter<NotFoundException> {
      catch(exception: NotFoundException, host: ArgumentsHost) {
        host.res.status(404).json({
          handledBy: 'NotFoundFilter',
          message: exception.message,
        })
      }
    }

    @Controller('/items')
    @UseFilters(NotFoundFilter)
    class ItemController {
      @Get('/:id')
      async getItem() {
        throw new NotFoundException('Item not found')
      }
    }

    const app = new App()
    app.registerControllers([ItemController])
    const client = createTestApp(app)

    const res = await client.get('/items/123')
    expect(res.status).toBe(404)
    expect(res.body.handledBy).toBe('NotFoundFilter')
    expect(res.body.message).toBe('Item not found not found')
  })
})

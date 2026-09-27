import { describe, it, expect, createTestApp } from '../src/testing'
import { App } from '../src/server/app'
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
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
  UseGuards,
  UseInterceptors,
  SetMetadata,
  Reflector,
  createParamDecorator,
  Cron,
  Global,
  Module,
  UsePipes,
  ParseIntPipe,
  ParseFloatPipe,
  ParseBoolPipe,
  ParseUUIDPipe,
  ParseArrayPipe,
  ValidationPipe,
  type ExceptionFilter,
  type ArgumentsHost,
  type ExecutionContext,
  type CanActivate,
  type Interceptor,
  type OnInit,
  type OnDestroy,
} from '../src/decorators'
import { Inject, Optional, forwardRef } from '../src/di'
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '../src/error'
import { tex } from '../src/validator'
import { generateOpenApiSpec } from '../src/swagger'

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

  it('automatically resolves constructor parameter dependencies without explicit @Inject decorator', async () => {
    @Injectable()
    class AuthService {
      login(username: string) {
        return { token: `jwt_${username}` }
      }
    }

    @Controller('/auth')
    class AuthController {
      constructor(public readonly authService: AuthService) {}

      @Get('/login')
      async login() {
        return this.authService.login('alice')
      }
    }

    // Set reflected parameter types as emitted by TypeScript
    ;(AuthController as any)['design:paramtypes'] = [AuthService]

    const app = new App()
    app.registerControllers([AuthController])
    const client = createTestApp(app)

    const res = await client.get('/auth/login')
    expect(res.status).toBe(200)
    expect(res.body.token).toBe('jwt_alice')
  })

  it('safely serializes Mongoose Documents, BSON ObjectIds, BigInt, Map, Set, and circular references', async () => {
    class FakeObjectId {
      _bsontype = 'ObjectID'
      constructor(private hex: string) {}
      toString() {
        return this.hex
      }
    }

    class FakeMongooseDoc {
      $__: { scope: string } = { scope: 'internal' }
      $isNew = false
      _id = new FakeObjectId('507f1f77bcf86cd799439011')
      title = 'Test Document'
      toObject() {
        return {
          _id: this._id,
          title: this.title,
          tags: new Set(['mongodb', 'exisjs']),
          metadata: new Map([['views', 42]]),
          count: BigInt(9007199254740991),
        }
      }
    }

    @Controller('/data')
    class DataController {
      @Get('/doc')
      async getDoc() {
        const doc = new FakeMongooseDoc()
        return doc
      }

      @Get('/circular')
      async getCircular() {
        const obj: any = { name: 'cyclic' }
        obj.self = obj
        return obj
      }
    }

    const app = new App()
    app.registerControllers([DataController])
    const client = createTestApp(app)

    const docRes = await client.get('/data/doc')
    expect(docRes.status).toBe(200)
    expect(docRes.body._id).toBe('507f1f77bcf86cd799439011')
    expect(docRes.body.title).toBe('Test Document')
    expect(docRes.body.tags).toEqual(['mongodb', 'exisjs'])
    expect(docRes.body.metadata).toEqual({ views: 42 })
    expect(docRes.body.count).toBe('9007199254740991')

    const circularRes = await client.get('/data/circular')
    expect(circularRes.status).toBe(200)
    expect(circularRes.body.name).toBe('cyclic')
    expect(circularRes.body.self).toBe('[Circular]')
  })

  it('automatically coerces query parameters and route params from strings to numbers and booleans', async () => {
    const leadQuerySchema = tex.object({
      search: tex.string({ optional: true }),
      page: tex.number({ optional: true, default: 1 }),
      limit: tex.number({ optional: true, default: 50 }),
      active: tex.boolean({ optional: true }),
    })

    const leadParamSchema = tex.object({
      id: tex.number(),
    })

    @Controller('/leads')
    class LeadsController {
      @Get('/')
      async getLeads(@Query(leadQuerySchema) query: any) {
        return {
          page: query.page,
          pageType: typeof query.page,
          limit: query.limit,
          limitType: typeof query.limit,
          active: query.active,
          activeType: typeof query.active,
        }
      }

      @Get('/:id', { params: leadParamSchema })
      async getLead(@Param('id') id: any) {
        return {
          id,
          idType: typeof id,
        }
      }
    }

    const app = new App()
    app.registerControllers([LeadsController])
    const client = createTestApp(app)

    const res = await client.get('/leads?page=3&limit=100&active=true')
    expect(res.status).toBe(200)
    expect(res.body.page).toBe(3)
    expect(res.body.pageType).toBe('number')
    expect(res.body.limit).toBe(100)
    expect(res.body.limitType).toBe('number')
    expect(res.body.active).toBe(true)
    expect(res.body.activeType).toBe('boolean')

    const paramRes = await client.get('/leads/456')
    expect(paramRes.status).toBe(200)
    expect(paramRes.body.id).toBe(456)
    expect(paramRes.body.idType).toBe('number')
  })

  it('disables etag generation by default for dynamic APIs to prevent 304 overhead', async () => {
    @Controller('/ledger')
    class LedgerController {
      @Get('/')
      async getLedger() {
        return { balance: 5000 }
      }
    }

    const app = new App()
    app.registerControllers([LedgerController])
    const client = createTestApp(app)

    const res1 = await client.get('/ledger')
    expect(res1.status).toBe(200)
    expect(res1.headers['etag']).toBeUndefined()

    // Subsequent request with If-None-Match should still return 200 fresh data
    const res2 = await client.get('/ledger', {
      headers: { 'if-none-match': '"some-etag"' },
    })
    expect(res2.status).toBe(200)
    expect(res2.body.balance).toBe(5000)
  })

  it('accurately resolves client IP behind reverse proxies and CDNs (Cloudflare, NGINX, AWS)', async () => {
    @Controller('/ip-check')
    class IpController {
      @Get('/')
      async getIp(req: any) {
        return {
          ip: req.ip,
          ips: req.ips,
          protocol: req.protocol,
          hostname: req.hostname,
        }
      }
    }

    const app = new App({ trustProxy: true })
    app.registerControllers([IpController])
    const client = createTestApp(app)

    // 1. Cloudflare CF-Connecting-IP
    const cfRes = await client.get('/ip-check', {
      headers: {
        'cf-connecting-ip': '203.0.113.195',
        'cf-visitor': JSON.stringify({ scheme: 'https' }),
        'x-forwarded-host': 'api.example.com:443',
      },
    })
    expect(cfRes.status).toBe(200)
    expect(cfRes.body.ip).toBe('203.0.113.195')
    expect(cfRes.body.protocol).toBe('https')
    expect(cfRes.body.hostname).toBe('api.example.com')

    // 2. NGINX X-Real-IP
    const nginxRes = await client.get('/ip-check', {
      headers: {
        'x-real-ip': '198.51.100.42',
      },
    })
    expect(nginxRes.status).toBe(200)
    expect(nginxRes.body.ip).toBe('198.51.100.42')

    // 3. AWS ALB X-Forwarded-For
    const albRes = await client.get('/ip-check', {
      headers: {
        'x-forwarded-for': '198.51.100.88, 10.0.0.1',
      },
    })
    expect(albRes.status).toBe(200)
    expect(albRes.body.ip).toBe('198.51.100.88')
  })

  it('formats HttpError and validation errors with standardized error response envelope', async () => {
    const userSchema = tex.object({
      email: tex.email(),
    })

    @Controller('/contacts')
    class ContactController {
      @Get('/delete/:id')
      async deleteContact() {
        throw new BadRequestException(
          'Cannot delete contact because they are associated with 3 active transaction(s).'
        )
      }

      @Post('/', { body: userSchema })
      async createContact(@Body(userSchema) body: any) {
        return body
      }
    }

    const app = new App()
    app.registerControllers([ContactController])
    const client = createTestApp(app)

    // 1. HttpError envelope
    const errRes = await client.get('/contacts/delete/100')
    expect(errRes.status).toBe(400)
    expect(errRes.body.success).toBe(false)
    expect(errRes.body.error.code).toBe('BAD_REQUEST')
    expect(errRes.body.error.message).toBe(
      'Cannot delete contact because they are associated with 3 active transaction(s).'
    )

    // 2. Validation error envelope
    const valRes = await client.post('/contacts', { email: 'not-an-email' })
    expect(valRes.status).toBe(400)
    expect(valRes.body.success).toBe(false)
    expect(valRes.body.statusCode).toBe(400)
    expect(valRes.body.validationErrors).toBeDefined()
    expect(valRes.body.validationErrors.email).toBeDefined()
    expect(typeof valRes.body.timestamp).toBe('string')
  })

  it('supports Class Controller Inheritance (Base and Abstract Controller Support)', async () => {
    // Abstract / Base CRUD Controller with routes and param decorators
    abstract class BaseCrudController<T> {
      protected abstract resourceName: string

      @Get('/')
      async findAll(): Promise<any> {
        return {
          resource: this.resourceName,
          items: [{ id: '1' }, { id: '2' }],
        }
      }

      @Get('/:id')
      async findById(@Param('id') id: string): Promise<any> {
        return { resource: this.resourceName, id }
      }

      @Delete('/:id')
      async remove(@Param('id') id: string): Promise<any> {
        return { deleted: true, id }
      }
    }

    // Derived User Controller
    @Controller('/users')
    class UsersController extends BaseCrudController<{
      id: string
      name: string
    }> {
      protected resourceName = 'users'

      // Subclass adds new route
      @Post('/')
      async create(@Body() body: any) {
        return { created: true, body }
      }

      // Subclass overrides base method with custom response
      @Delete('/:id')
      async remove(@Param('id') id: string): Promise<any> {
        return { customDeleted: true, id, resource: this.resourceName }
      }
    }

    // Derived Product Controller inheriting base directly without overrides
    @Controller('/products')
    class ProductsController extends BaseCrudController<{
      id: string
      title: string
    }> {
      protected resourceName = 'products'
    }

    const app = new App()
    app.registerControllers([UsersController, ProductsController])
    const client = createTestApp(app)

    // 1. Inherited GET /users
    const usersListRes = await client.get('/users')
    expect(usersListRes.status).toBe(200)
    expect(usersListRes.body.resource).toBe('users')
    expect(usersListRes.body.items).toHaveLength(2)

    // 2. Inherited GET /users/:id with @Param('id')
    const userDetailRes = await client.get('/users/user_abc')
    expect(userDetailRes.status).toBe(200)
    expect(userDetailRes.body.resource).toBe('users')
    expect(userDetailRes.body.id).toBe('user_abc')

    // 3. Subclass-defined POST /users
    const createRes = await client.post('/users', { name: 'Alice' })
    expect(createRes.status).toBe(200)
    expect(createRes.body.created).toBe(true)
    expect(createRes.body.body.name).toBe('Alice')

    // 4. Overridden DELETE /users/:id
    const deleteRes = await client.delete('/users/user_abc')
    expect(deleteRes.status).toBe(200)
    expect(deleteRes.body.customDeleted).toBe(true)
    expect(deleteRes.body.id).toBe('user_abc')

    // 5. Products controller inheriting all base routes
    const productsListRes = await client.get('/products')
    expect(productsListRes.status).toBe(200)
    expect(productsListRes.body.resource).toBe('products')
    expect(productsListRes.body.items).toHaveLength(2)

    const productDetailRes = await client.get('/products/prod_123')
    expect(productDetailRes.status).toBe(200)
    expect(productDetailRes.body.resource).toBe('products')
    expect(productDetailRes.body.id).toBe('prod_123')

    const productDeleteRes = await client.delete('/products/prod_123')
    expect(productDeleteRes.status).toBe(200)
    expect(productDeleteRes.body.deleted).toBe(true)
    expect(productDeleteRes.body.id).toBe('prod_123')
  })

  it('supports Property-Level @Inject and @Optional decorators on classes and controllers', async () => {
    @Injectable()
    class ConfigService {
      getAppName() {
        return 'ExisEnterpriseApp'
      }
    }

    @Injectable()
    class PaymentGateway {
      process() {
        return { success: true, txnId: 'tx_999' }
      }
    }

    @Injectable()
    class OrderService {
      // 1. Property injection with explicit class token
      @Inject(ConfigService)
      public config!: ConfigService

      // 2. Property injection with string token
      @Inject('API_SECRET')
      public apiSecret!: string

      // 3. Optional property injection
      @Inject('OPTIONAL_METRICS')
      @Optional()
      public metrics?: any

      // 4. Property injection with class token
      @Inject(PaymentGateway)
      public payment!: PaymentGateway

      checkout() {
        return {
          app: this.config.getAppName(),
          secret: this.apiSecret,
          payment: this.payment.process(),
          metrics: this.metrics || null,
        }
      }
    }

    @Controller('/orders')
    class OrderController {
      // Property injection directly on controller
      @Inject(OrderService)
      private orderService!: OrderService

      @Get('/checkout')
      async checkout() {
        return this.orderService.checkout()
      }
    }

    const app = new App()
    app.container.provide('API_SECRET', { useValue: 'sec_xyz_123' })
    app.registerControllers([OrderController])
    const client = createTestApp(app)

    const res = await client.get('/orders/checkout')
    expect(res.status).toBe(200)
    expect(res.body.app).toBe('ExisEnterpriseApp')
    expect(res.body.secret).toBe('sec_xyz_123')
    expect(res.body.payment.txnId).toBe('tx_999')
    expect(res.body.metrics).toBeNull()
  })

  it('resolves Circular Dependencies between services using forwardRef() and Lazy Proxy resolution', async () => {
    // Service A depends on Service B, Service B depends on Service A
    @Injectable()
    class ServiceA {
      @Inject(forwardRef(() => ServiceB))
      public serviceB!: ServiceB

      getName() {
        return 'ServiceA'
      }

      callB() {
        return `A -> ${this.serviceB.getName()}`
      }
    }

    @Injectable()
    class ServiceB {
      @Inject(forwardRef(() => ServiceA))
      public serviceA!: ServiceA

      getName() {
        return 'ServiceB'
      }

      callA() {
        return `B -> ${this.serviceA.getName()}`
      }
    }

    const app = new App()
    app.provide(ServiceA, { useClass: ServiceA })
    app.provide(ServiceB, { useClass: ServiceB })

    const a = app.resolve(ServiceA)
    const b = app.resolve(ServiceB)

    expect(a.getName()).toBe('ServiceA')
    expect(b.getName()).toBe('ServiceB')
    expect(a.callB()).toBe('A -> ServiceB')
    expect(b.callA()).toBe('B -> ServiceA')
  })

  it('transforms and validates parameters with built-in Pipes (ParseIntPipe, ParseBoolPipe, ParseUUIDPipe, ParseArrayPipe, @UsePipes)', async () => {
    @Controller('/pipes')
    class PipeTestController {
      @Get('/int/:id')
      async getInt(@Param('id', ParseIntPipe) id: number) {
        return { id, type: typeof id }
      }

      @Get('/float')
      async getFloat(@Query('rate', ParseFloatPipe) rate: number) {
        return { rate, type: typeof rate }
      }

      @Get('/bool')
      async getBool(@Query('active', ParseBoolPipe) active: boolean) {
        return { active, type: typeof active }
      }

      @Get('/uuid/:id')
      async getUUID(@Param('id', ParseUUIDPipe) id: string) {
        return { id, valid: true }
      }

      @Get('/array')
      async getArray(
        @Query('tags', new ParseArrayPipe({ items: ParseIntPipe }))
        tags: number[]
      ) {
        return { tags, isArray: Array.isArray(tags) }
      }

      @Post('/use-pipes')
      @UsePipes(new ValidationPipe({ transform: true }))
      async createWithPipe(@Body() body: any) {
        return { body, success: true }
      }
    }

    const app = new App()
    app.registerControllers([PipeTestController])
    const client = createTestApp(app)

    // 1. ParseIntPipe success & failure
    const intRes = await client.get('/pipes/int/123')
    expect(intRes.status).toBe(200)
    expect(intRes.body.id).toBe(123)
    expect(intRes.body.type).toBe('number')

    const intFail = await client.get('/pipes/int/invalid-int')
    expect(intFail.status).toBe(400)

    // 2. ParseFloatPipe
    const floatRes = await client.get('/pipes/float?rate=3.14159')
    expect(floatRes.status).toBe(200)
    expect(floatRes.body.rate).toBeCloseTo(3.14159)
    expect(floatRes.body.type).toBe('number')

    // 3. ParseBoolPipe
    const boolRes = await client.get('/pipes/bool?active=true')
    expect(boolRes.status).toBe(200)
    expect(boolRes.body.active).toBe(true)
    expect(boolRes.body.type).toBe('boolean')

    const boolFail = await client.get('/pipes/bool?active=not-a-bool')
    expect(boolFail.status).toBe(400)

    // 4. ParseUUIDPipe
    const validUuid = '123e4567-e89b-12d3-a456-426614174000'
    const uuidRes = await client.get(`/pipes/uuid/${validUuid}`)
    expect(uuidRes.status).toBe(200)
    expect(uuidRes.body.valid).toBe(true)

    const uuidFail = await client.get('/pipes/uuid/not-a-uuid')
    expect(uuidFail.status).toBe(400)

    // 5. ParseArrayPipe with ParseIntPipe items
    const arrayRes = await client.get('/pipes/array?tags=10,20,30')
    expect(arrayRes.status).toBe(200)
    expect(arrayRes.body.tags).toEqual([10, 20, 30])
    expect(arrayRes.body.isArray).toBe(true)

    // 6. @UsePipes
    const usePipesRes = await client.post('/pipes/use-pipes', {
      username: 'john',
    })
    expect(usePipesRes.status).toBe(200)
    expect(usePipesRes.body.success).toBe(true)
  })

  it('shares services across modules using @Global() Module decorator without explicit re-importing', async () => {
    @Injectable()
    class GlobalAuditService {
      logAction(action: string) {
        return `[Audit] ${action}`
      }
    }

    @Global()
    @Module({
      providers: [GlobalAuditService],
      exports: [GlobalAuditService],
    })
    class GlobalCoreModule {}

    @Controller('/feature')
    class FeatureController {
      @Inject(GlobalAuditService)
      private audit!: GlobalAuditService

      @Get('/action')
      async doAction() {
        return { audit: this.audit.logAction('user_registered') }
      }
    }

    @Module({
      controllers: [FeatureController],
    })
    class FeatureModule {}

    const app = new App()
    await app.register(GlobalCoreModule)
    await app.register(FeatureModule)

    const client = createTestApp(app)
    const res = await client.get('/feature/action')
    expect(res.status).toBe(200)
    expect(res.body.audit).toBe('[Audit] user_registered')
  })

  it('passes rich ExecutionContext to Guards and Interceptors with Reflector metadata inspection', async () => {
    // Custom metadata decorator
    const SetScopes = (...scopes: string[]) => SetMetadata('scopes', scopes)

    @Injectable()
    class ScopeGuard implements CanActivate {
      canActivate(context: ExecutionContext): boolean {
        const handler = context.getHandler()
        const targetClass = context.getClass()
        const requiredScopes = Reflector.getAllAndOverride<string[]>('scopes', [
          handler,
          targetClass,
        ])
        const req = context.switchToHttp().getRequest()
        if (!requiredScopes || requiredScopes.length === 0) return true
        const userScopes = req.user?.scopes || []
        return requiredScopes.every((scope) => userScopes.includes(scope))
      }
    }

    @Injectable()
    class AuditInterceptor implements Interceptor {
      async intercept(context: ExecutionContext, next: any) {
        const req = context.switchToHttp().getRequest()
        const res = context.switchToHttp().getResponse()
        res.setHeader('X-Executed-By', context.getClass().name)
        return next?.handle ? next.handle() : undefined
      }
    }

    @Controller('/scoped')
    @UseGuards(ScopeGuard)
    @UseInterceptors(AuditInterceptor)
    @SetScopes('read:general')
    class ScopedController {
      @Get('/general')
      async getGeneral() {
        return { message: 'general_ok' }
      }

      @Get('/admin')
      @SetScopes('read:admin')
      async getAdmin() {
        return { message: 'admin_ok' }
      }
    }

    let currentUser: any = undefined

    const app = new App()
    app.use((req: any, _res: any, next: any) => {
      req.user = currentUser
      next()
    })
    app.registerControllers([ScopedController])
    const client = createTestApp(app)

    // 1. Without scopes -> 403 Forbidden
    const failRes = await client.get('/scoped/general')
    expect(failRes.status).toBe(403)

    // 2. With read:general scope -> 200 OK + Header from Interceptor
    currentUser = { scopes: ['read:general'] }
    const generalRes = await client.get('/scoped/general')
    expect(generalRes.status).toBe(200)
    expect(generalRes.body.message).toBe('general_ok')
    expect(generalRes.headers['x-executed-by']).toBe('ScopedController')

    // 3. Trying to access route with overridden required scope read:admin
    const adminFailRes = await client.get('/scoped/admin')
    expect(adminFailRes.status).toBe(403)

    // 4. Accessing with read:admin scope
    currentUser = { scopes: ['read:admin'] }
    const adminPassRes = await client.get('/scoped/admin')
    expect(adminPassRes.status).toBe(200)
    expect(adminPassRes.body.message).toBe('admin_ok')
  })

  it('automatically registers @Cron jobs on @Injectable() providers provided via Modules and app.provide()', async () => {
    let cronExecuted = false

    @Injectable()
    class BackgroundWorker {
      @Cron('*/5 * * * * *', { name: 'WorkerCleanup' })
      cleanup() {
        cronExecuted = true
      }
    }

    @Module({
      providers: [BackgroundWorker],
    })
    class WorkerModule {}

    const app = new App()
    await app.register(WorkerModule)

    // Check that job was automatically scheduled on app.cron
    expect(app.cron.has('WorkerCleanup')).toBe(true)
    const workerJob = app.cron.getJob('WorkerCleanup')
    expect(workerJob).toBeDefined()

    // Execute the scheduled job
    await workerJob?.trigger()
    expect(cronExecuted).toBe(true)
  })

  it('validates DTO classes with custom .validate() methods and Standard Schema in ValidationPipe', async () => {
    class CreateOrderDto {
      item!: string
      quantity!: number

      validate() {
        const errors: Record<string, string> = {}
        if (!this.item || this.item.length < 3) {
          errors.item = 'Item must be at least 3 characters'
        }
        if (!this.quantity || this.quantity <= 0) {
          errors.quantity = 'Quantity must be greater than 0'
        }
        return Object.keys(errors).length > 0 ? errors : null
      }
    }

    @Controller('/dto-test')
    class DtoTestController {
      @Post('/order')
      @UsePipes(new ValidationPipe({ transform: true }))
      async createOrder(@Body(CreateOrderDto) dto: CreateOrderDto) {
        return { success: true, dto, isInstance: dto instanceof CreateOrderDto }
      }
    }

    const app = new App()
    app.registerControllers([DtoTestController])
    const client = createTestApp(app)

    // 1. Invalid payload -> 400 Bad Request
    const failRes = await client.post('/dto-test/order', {
      item: 'ab',
      quantity: -5,
    })
    expect(failRes.status).toBe(400)
    expect(failRes.body.validationErrors).toBeDefined()
    expect(failRes.body.validationErrors.item).toBe(
      'Item must be at least 3 characters'
    )

    // 2. Valid payload -> 200 OK + instantiated DTO instance
    const passRes = await client.post('/dto-test/order', {
      item: 'Laptop',
      quantity: 2,
    })
    expect(passRes.status).toBe(200)
    expect(passRes.body.success).toBe(true)
    expect(passRes.body.isInstance).toBe(true)
    expect(passRes.body.dto.item).toBe('Laptop')
  })

  it('passes ExecutionContext to createParamDecorator factories', async () => {
    const CurrentUser = createParamDecorator(
      (data: string | undefined, ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest()
        return data ? req.user?.[data] : req.user
      }
    )

    @Controller('/profile')
    class ProfileController {
      @Get('/me')
      async getMe(
        @CurrentUser() user: any,
        @CurrentUser('email') email: string
      ) {
        return { user, email }
      }
    }

    const app = new App()
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'u123', name: 'Bob', email: 'bob@example.com' }
      next()
    })
    app.registerControllers([ProfileController])
    const client = createTestApp(app)

    const res = await client.get('/profile/me')
    expect(res.status).toBe(200)
    expect(res.body.user.name).toBe('Bob')
    expect(res.body.email).toBe('bob@example.com')
  })

  it('infers OpenAPI parameter types from built-in Transformation Pipes', async () => {
    @Controller('/swagger-pipes')
    class SwaggerPipeController {
      @Get('/:id')
      async getItem(
        @Param('id', ParseIntPipe) id: number,
        @Query('active', ParseBoolPipe) active: boolean
      ) {
        return { id, active }
      }
    }

    const app = new App()
    app.registerControllers([SwaggerPipeController])

    const spec = generateOpenApiSpec(app)
    const op = spec.paths['/swagger-pipes/{id}']?.get
    expect(op).toBeDefined()
    expect(op?.parameters).toBeDefined()

    const pathParam = op?.parameters?.find((p: any) => p.name === 'id')
    expect(pathParam).toBeDefined()
    expect(pathParam?.schema?.type).toBe('integer')

    const queryParam = op?.parameters?.find((p: any) => p.name === 'active')
    expect(queryParam).toBeDefined()
    expect(queryParam?.schema?.type).toBe('boolean')
  })
})

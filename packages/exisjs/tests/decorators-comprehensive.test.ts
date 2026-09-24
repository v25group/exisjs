import { App } from '../src/server/app'
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Use,
  UseUpload,
  UploadedFile,
  UploadedFiles,
  Timeout,
  Idempotent,
  HttpCode,
  Header,
  Redirect,
  Permissions,
  Hosts,
  Req,
  Res,
  Body,
  Query,
  Param,
  Headers,
  HostParam,
  Ip,
  RateLimit,
  Cors,
  IpFilter,
  Compress,
  Dedupe,
  Cookies,
  Cookie,
  State,
  AppCtx,
  Fields,
  SetMetadata,
  Reflector,
  Injectable,
  Module,
  Server,
  Boundary,
} from '../src/decorators'
import { Inject, Optional, inject } from '../src/di'
import { tex } from '../src/validator'
import { describe, expect, it } from '../src/testing'
import { createTestContext } from '../src/testing'
import { Readable } from 'node:stream'

describe('Comprehensive OOP Decorators Suite', () => {
  it('should export all decorators and DI utilities correctly', () => {
    expect(typeof Inject).toBe('function')
    expect(typeof Optional).toBe('function')
    expect(typeof inject).toBe('function')
    expect(typeof Controller).toBe('function')
    expect(typeof Get).toBe('function')
    expect(typeof Post).toBe('function')
    expect(typeof UseUpload).toBe('function')
    expect(typeof Timeout).toBe('function')
    expect(typeof Idempotent).toBe('function')
    expect(typeof RateLimit).toBe('function')
    expect(typeof Cors).toBe('function')
    expect(typeof IpFilter).toBe('function')
    expect(typeof Compress).toBe('function')
    expect(typeof Dedupe).toBe('function')
    expect(typeof Cookies).toBe('function')
    expect(typeof Cookie).toBe('function')
    expect(typeof State).toBe('function')
    expect(typeof AppCtx).toBe('function')
    expect(typeof Fields).toBe('function')
    expect(typeof HttpCode).toBe('function')
    expect(typeof Header).toBe('function')
    expect(typeof Redirect).toBe('function')
  })

  it('should handle parameter extraction, validation schemas, and custom headers/status codes in OOP controller', async () => {
    const app = new App({ asyncContext: true })

    const CreateUserSchema = tex.object({
      name: tex.string({ min: 2 }),
      age: tex.number({ coerce: true }),
    })

    const QuerySchema = tex.object({
      filter: tex.string({ optional: true }),
    })

    const ParamSchema = tex.object({
      id: tex.number({ coerce: true }),
    })

    @Controller('/users')
    class UsersController {
      @Post('/')
      @HttpCode(201)
      @Header('X-Custom-Header', 'ExisJS-OOP')
      async createUser(body: any) {
        return { success: true, user: body }
      }

      @Get('/:id', { query: QuerySchema, params: ParamSchema })
      async getUser(
        id: string,
        filter: string,
        auth: string,
        clientIp: string
      ) {
        return { id: Number(id), filter, auth, ip: clientIp }
      }
    }
    Body(CreateUserSchema)(UsersController.prototype, 'createUser', 0)
    Param('id')(UsersController.prototype, 'getUser', 0)
    Query('filter')(UsersController.prototype, 'getUser', 1)
    Headers('authorization')(UsersController.prototype, 'getUser', 2)
    Ip()(UsersController.prototype, 'getUser', 3)

    app.registerControllers([UsersController])

    // Test POST with validation and custom status/headers
    const postRes = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'Alice', age: '28' },
    })

    expect(postRes.status).toBe(201)
    expect(postRes.headers['x-custom-header']).toBe('ExisJS-OOP')
    expect(postRes.body).toEqual({
      success: true,
      user: { name: 'Alice', age: 28 },
    })

    // Test validation failure
    const badRes = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'A', age: '28' },
    })
    expect(badRes.status).toBe(400)
    expect(badRes.body.error).toBe('Bad Request')

    // Test GET with params, query, headers, ip
    const getRes = await app.inject({
      method: 'GET',
      url: '/users/42?filter=active',
      headers: { authorization: 'Bearer secret_token' },
    })
    expect(getRes.status).toBe(200)
    expect(getRes.body).toEqual({
      id: 42,
      filter: 'active',
      auth: 'Bearer secret_token',
      ip: '127.0.0.1',
    })
  })

  it('should auto-pipe Node.js stream and Web ReadableStream returned from OOP controller methods', async () => {
    const app = new App({ asyncContext: true })

    @Controller('/streams')
    class StreamController {
      @Get('/node')
      getNodeStream() {
        return Readable.from(['chunk1', 'chunk2', 'chunk3'])
      }

      @Get('/async-iter')
      getAsyncIter() {
        return (async function* () {
          yield 'partA'
          yield 'partB'
        })()
      }
    }

    app.registerControllers([StreamController])

    const nodeRes = await app.inject({ url: '/streams/node' })
    expect(nodeRes.status).toBe(200)
    expect(nodeRes.text).toBe('chunk1chunk2chunk3')

    const iterRes = await app.inject({ url: '/streams/async-iter' })
    expect(iterRes.status).toBe(200)
    expect(iterRes.text).toBe('partApartB')
  })

  it('should support @Redirect in OOP controller methods', async () => {
    const app = new App({ asyncContext: true })

    @Controller('/nav')
    class NavController {
      @Get('/login')
      @Redirect('https://auth.example.com/login', 301)
      login() {}
    }

    app.registerControllers([NavController])

    const res = await app.inject({ url: '/nav/login' })
    expect(res.status).toBe(301)
    expect(res.headers['location']).toBe('https://auth.example.com/login')
  })

  it('should support @Cors, @RateLimit, and @IpFilter on OOP controllers', async () => {
    const app = new App({ asyncContext: true })

    @Controller('/secured')
    @Cors({ origin: 'https://client.com' })
    @RateLimit({ max: 2, windowMs: 60000 })
    class SecuredController {
      @Get('/data')
      getData() {
        return { secured: true }
      }
    }

    app.registerControllers([SecuredController])

    const res1 = await app.inject({
      url: '/secured/data',
      headers: { origin: 'https://client.com' },
    })
    expect(res1.status).toBe(200)
    expect(res1.headers['access-control-allow-origin']).toBe(
      'https://client.com'
    )
    expect(res1.body).toEqual({ secured: true })

    const res2 = await app.inject({ url: '/secured/data' })
    expect(res2.status).toBe(200)

    // Third request triggers rate limit (max 2)
    const res3 = await app.inject({ url: '/secured/data' })
    expect(res3.status).toBe(429)
  })

  it('should support @Cookies, @State, and @AppCtx parameter extraction in OOP controller methods', async () => {
    const app = new App({ asyncContext: true })

    @Controller('/context')
    class ContextController {
      @Get('/info')
      getInfo(sessionId: string, tenantId: string, appInstance: any) {
        return {
          session: sessionId,
          tenant: tenantId,
          hasApp: Boolean(appInstance && appInstance.router),
        }
      }
    }
    Cookie('session_id')(ContextController.prototype, 'getInfo', 0)
    State('tenant_id')(ContextController.prototype, 'getInfo', 1)
    AppCtx()(ContextController.prototype, 'getInfo', 2)

    app.use((req: any, _res: any, next: any) => {
      req.cookies = { session_id: 'sess_abc123' }
      req.state = { tenant_id: 'tenant_xyz' }
      next()
    })

    app.registerControllers([ContextController])

    const res = await app.inject({ url: '/context/info' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      session: 'sess_abc123',
      tenant: 'tenant_xyz',
      hasApp: true,
    })
  })

  describe('@Server & createTestContext Bootstrapping', () => {
    class ConfigService {
      getApiKey() {
        return 'key_12345'
      }
    }

    @Injectable()
    class AuthService {
      constructor(private config: ConfigService) {}
      verify() {
        return this.config.getApiKey() === 'key_12345'
      }
    }
    Inject(ConfigService)(AuthService, undefined, 0)

    @Controller('/auth')
    class AuthController {
      constructor(private authService: AuthService) {}

      @Get('/check')
      check() {
        return { valid: this.authService.verify() }
      }
    }
    Inject(AuthService)(AuthController, undefined, 0)

    @Server({
      providers: [
        ConfigService,
        AuthService,
        ['CUSTOM_VAL', { useValue: 'custom_secret' }],
      ],
    })
    class RootServer {
      async onStart(appInstance: any) {
        appInstance.registerControllers([AuthController])
      }
    }

    const testCtx = createTestContext(RootServer)

    it('should boot @Server class with class and tuple providers in createTestContext', async () => {
      const res = await testCtx.get('/auth/check').execute()

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ valid: true })
    })
  })

  describe('Route Method Decorators with Raw TexEngine and RouteSchema', () => {
    const userParamsSchema = tex.object({
      id: tex.string(),
    })
    const createUserSchema = tex.object({
      name: tex.string({ min: 2 }),
    })

    @Controller('/schema-test')
    class SchemaTestController {
      @Get('/:id', userParamsSchema)
      getById(@Param('id') id: string) {
        return { id }
      }

      @Post('/', createUserSchema)
      create(@Body() body: any) {
        return { name: body.name }
      }

      @Get('/wrapped/:id', { params: userParamsSchema })
      getWrapped(@Param('id') id: string) {
        return { wrappedId: id }
      }
    }

    it('should register and execute routes with raw TexEngine and wrapped RouteSchema', async () => {
      const app = new App()
      app.registerControllers([SchemaTestController])

      const res1 = await app.inject({
        method: 'GET',
        url: '/schema-test/123',
      })
      expect(res1.status).toBe(200)
      expect(res1.body).toEqual({ id: '123' })

      const res2 = await app.inject({
        method: 'POST',
        url: '/schema-test',
        payload: { name: 'Alice' },
      })
      expect(res2.status).toBe(200)
      expect(res2.body).toEqual({ name: 'Alice' })

      const res3 = await app.inject({
        method: 'GET',
        url: '/schema-test/wrapped/456',
      })
      expect(res3.status).toBe(200)
      expect(res3.body).toEqual({ wrappedId: '456' })
    })
  })
})

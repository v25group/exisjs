import { App } from '../src/server/app'
import {
  Controller,
  Get,
  Post,
  Module,
  SetMetadata,
  Reflector,
  createParamDecorator,
} from '../src/decorators'
import { Inject, Optional } from '../src/di'
import { describe, expect, it } from '../src/testing'

describe('OOP Parity & Metadata Utilities', () => {
  it('should register @Module() with controllers and providers', async () => {
    const app = new App({ asyncContext: true })

    class GreetingService {
      greet(name: string) {
        return `Hello, ${name}!`
      }
    }

    @Controller('/oop')
    class OopController {
      greetingService: GreetingService
      constructor(greetingService: GreetingService) {
        this.greetingService = greetingService
      }

      @Get('/greet')
      getGreeting() {
        return { message: this.greetingService.greet('Exis') }
      }
    }
    Inject(GreetingService)(OopController, undefined, 0)

    @Module({
      controllers: [OopController],
      providers: [GreetingService],
    })
    class GreetingModule {}

    await app.register(GreetingModule)

    const res = await app.inject({ url: '/oop/greet' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Hello, Exis!' })
  })

  it('should support sub-module imports in @Module()', async () => {
    const app = new App({ asyncContext: true })

    class DatabaseService {
      url = 'postgres://cluster'
    }

    @Module({
      providers: [DatabaseService],
    })
    class DatabaseModule {}

    @Controller('/info')
    class InfoController {
      db: DatabaseService
      constructor(db: DatabaseService) {
        this.db = db
      }

      @Get('/')
      getInfo() {
        return { db: this.db.url }
      }
    }
    Inject(DatabaseService)(InfoController, undefined, 0)

    @Module({
      imports: [DatabaseModule],
      controllers: [InfoController],
    })
    class AppModule {}

    await app.register(AppModule)

    const res = await app.inject({ url: '/info' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ db: 'postgres://cluster' })
  })

  it('should attach and read custom metadata with @SetMetadata and Reflector', () => {
    @SetMetadata('roles', ['admin', 'manager'])
    class AdminController {
      @SetMetadata('permissions', ['write:users'])
      createUser() {}
    }

    // Reflector.get on class
    const classRoles = Reflector.get('roles', AdminController)
    expect(classRoles).toEqual(['admin', 'manager'])

    // Reflector.get on method
    const methodPermissions = Reflector.get(
      'permissions',
      AdminController.prototype.createUser
    )
    expect(methodPermissions).toEqual(['write:users'])

    // Reflector.getAllAndOverride
    const overrideResult = Reflector.getAllAndOverride('roles', [
      AdminController.prototype.createUser,
      AdminController,
    ])
    expect(overrideResult).toEqual(['admin', 'manager'])

    // Reflector.getAllAndMerge
    @SetMetadata('tags', ['api'])
    class TaggedController {
      @SetMetadata('tags', ['users'])
      getUser() {}
    }

    const mergedTags = Reflector.getAllAndMerge('tags', [
      TaggedController.prototype.getUser,
      TaggedController,
    ])
    expect(mergedTags).toEqual(['users', 'api'])
  })

  it('should create and execute custom param decorator with createParamDecorator', async () => {
    const app = new App({ asyncContext: true })

    // Build custom param decorator
    const CurrentUser = createParamDecorator(
      (prop: string | undefined, ctx) => {
        const user = (ctx.req as any).user || { id: 'u-100', role: 'admin' }
        return prop ? user[prop] : user
      }
    )

    @Controller('/account')
    class AccountController {
      @Get('/me')
      getMe(user: any) {
        return { user }
      }

      @Get('/role')
      getRole(role: string) {
        return { role }
      }
    }
    CurrentUser()(AccountController.prototype, 'getMe', 0)
    CurrentUser('role')(AccountController.prototype, 'getRole', 0)

    app.registerControllers([AccountController])

    const resUser = await app.inject({ url: '/account/me' })
    expect(resUser.status).toBe(200)
    expect(resUser.body).toEqual({ user: { id: 'u-100', role: 'admin' } })

    const resRole = await app.inject({ url: '/account/role' })
    expect(resRole.status).toBe(200)
    expect(resRole.body).toEqual({ role: 'admin' })
  })
})

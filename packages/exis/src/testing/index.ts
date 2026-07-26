export * from './mocks'
export type { TestResponse, TestApp } from './client'
export { TestRequest } from './client'

import * as _nodeTest from 'node:test'
import _assert from 'node:assert'
import util from 'node:util'
import { createTestApp, TestApp } from './client'

export interface TestOptions {
  only?: boolean
  skip?: boolean | string
  todo?: boolean | string
  concurrency?: number | boolean
  timeout?: number
}

export interface TestContext {
  name: string
  skip(message?: string): void
  todo(message?: string): void
  test(name: string, fn?: TestFunction): void
  test(name: string, options: TestOptions, fn?: TestFunction): void
}

export type TestFunction = (t: TestContext) => void | Promise<void>
export type HookFunction = () => void | Promise<void>

export interface TestApi {
  (name: string, fn?: TestFunction): void
  (name: string, options: TestOptions, fn?: TestFunction): void
  only(name: string, fn?: TestFunction): void
  only(name: string, options: TestOptions, fn?: TestFunction): void
  skip(name: string, fn?: TestFunction): void
  skip(name: string, options: TestOptions, fn?: TestFunction): void
  todo(name: string, fn?: TestFunction): void
  todo(name: string, options: TestOptions, fn?: TestFunction): void
  each<T = any>(
    cases: T[]
  ): (name: string, fn: (...args: any[]) => void | Promise<void>) => void
}

export type HookApi = (fn: HookFunction) => void

// Re-export native test runner features with top-tier TypeScript support

function applyEach(baseTestFn: any): TestApi {
  baseTestFn.each = function (cases: any[]) {
    return (name: string, fn: (...args: any[]) => void | Promise<void>) => {
      for (const c of cases) {
        const testArgs = Array.isArray(c) ? c : [c]
        const testName = util.format(name, ...testArgs)
        baseTestFn(testName, () => fn(...testArgs))
      }
    }
  }
  return baseTestFn as TestApi
}

export const test = applyEach(_nodeTest.test)
export const describe = applyEach(_nodeTest.describe)
export const it = applyEach(_nodeTest.it)
export const before = _nodeTest.before as unknown as HookApi
export const beforeAll = _nodeTest.before as unknown as HookApi
export const after = _nodeTest.after as unknown as HookApi
export const afterAll = _nodeTest.after as unknown as HookApi
export const beforeEach = _nodeTest.beforeEach as unknown as HookApi
export const afterEach = _nodeTest.afterEach as unknown as HookApi
export const mock = _nodeTest.mock

function applyMockPolyfill(fn: any) {
  if (!fn.mock) return fn
  fn.mockRestore = () => fn.mock.restore()
  fn.mockImplementation = (impl: any) => {
    fn.mock.mockImplementation(impl)
    return fn
  }
  fn.mockResolvedValue = (val: any) => {
    fn.mock.mockImplementation(async () => val)
    return fn
  }
  fn.mockReturnValue = (val: any) => {
    fn.mock.mockImplementation(() => val)
    return fn
  }
  fn.mockRejectedValue = (err: any) => {
    fn.mock.mockImplementation(async () => {
      throw err
    })
    return fn
  }
  fn.mockClear = () => fn.mock.resetCalls()
  return fn
}

export const ex = {
  fn: (impl?: any) => applyMockPolyfill(_nodeTest.mock.fn(impl)),
  spyOn: (obj: any, methodName: string) =>
    applyMockPolyfill(_nodeTest.mock.method(obj, methodName)),
  timers: _nodeTest.mock.timers,
  mock: (specifier: string, factory?: () => any) => {
    if (factory) {
      const mockExports = factory()
      const options: any = {}
      if (mockExports.default) {
        options.defaultExport = mockExports.default
        const { default: _, ...named } = mockExports
        options.namedExports = named
      } else {
        options.namedExports = mockExports
      }
      _nodeTest.mock.module(specifier, options)
    } else {
      _nodeTest.mock.module(specifier)
    }
  },
  setSystemTime: (time: number | Date) => {
    try {
      _nodeTest.mock.timers.enable({
        apis: ['Date', 'setTimeout', 'setInterval', 'setImmediate'],
      })
    } catch {
      /* ignore if already enabled */
    }
    _nodeTest.mock.timers.setTime(time.valueOf() as number)
  },
  advanceTimersByTime: (ms: number) => {
    try {
      _nodeTest.mock.timers.enable({
        apis: ['Date', 'setTimeout', 'setInterval', 'setImmediate'],
      })
    } catch {
      /* ignore */
    }
    _nodeTest.mock.timers.tick(ms)
  },
  useFakeTimers: () => {
    try {
      _nodeTest.mock.timers.enable({
        apis: ['Date', 'setTimeout', 'setInterval', 'setImmediate'],
      })
    } catch {
      /* ignore */
    }
  },
  useRealTimers: () => {
    _nodeTest.mock.timers.reset()
  },
  clearAllMocks: () => _nodeTest.mock.reset(),
}
export const assert = _nodeTest.assert || _assert
export { expect } from './expect'

import { App } from '../server/app'

export function createTestContext(appInput: any): TestApp {
  let app = appInput

  // Handle @Server decorated classes natively
  if (
    app &&
    typeof app === 'function' &&
    app.prototype &&
    app.prototype[Symbol.for('exisjs:server_config')]
  ) {
    const serverConfig = app.prototype[Symbol.for('exisjs:server_config')]
    const instance = new App({
      plugins: serverConfig.plugins,
    })

    const serverInstance = new app()
    if (serverConfig.providers) {
      for (const p of serverConfig.providers) {
        instance.provide(p[0], p[1])
      }
    }

    instance.onStartHook = async () => {
      if (typeof serverInstance.onStart === 'function') {
        await serverInstance.onStart(instance)
      }
    }

    instance.onCloseHook = async () => {
      if (typeof serverInstance.onClose === 'function') {
        await serverInstance.onClose(instance)
      }
    }

    app = instance
  }

  process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION DETECTED:', reason)
  })

  before(async () => {
    if (typeof app.create === 'function') {
      await app.create()
    }
    if (typeof app.onStartHook === 'function') {
      await app.onStartHook(app)
    }

    // Wait for Mongoose to finish connecting to prevent node:test race conditions
    // where tests finish faster than the DB connection, causing node:test to cancel them.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createRequire } = require('node:module')
      const requireFromCwd = createRequire(process.cwd() + '/package.json')
      const mongoose = requireFromCwd('mongoose')
      console.log(
        'mongoose.__connectionPromise exists:',
        !!mongoose.__connectionPromise
      )
      if (mongoose.__connectionPromise) {
        await mongoose.__connectionPromise
      } else if (mongoose.connection && mongoose.connection.readyState === 2) {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        await mongoose.connection.asPromise().catch(() => {})
      }
    } catch {
      // noop
    }

    // Flush the microtask queue so that background promises (like mongoose.connect)
    // fully resolve before the test suite starts.
    await new Promise((r) => setTimeout(r, 50))
  })

  after(async () => {
    // Attempt graceful shutdown of database connections to let event loop exit
    console.log('Testing: executing after hook')

    // Mongoose
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createRequire } = require('node:module')
      const requireFromCwd = createRequire(process.cwd() + '/package.json')
      const mongoose = requireFromCwd('mongoose')
      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        if (mongoose.connection.readyState === 2) {
          // 2 = connecting
          console.log('Testing: awaiting mongoose connection')
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          await mongoose.connection.asPromise().catch(() => {})
        }
        console.log('Testing: disconnecting mongoose')
        await mongoose.disconnect()
        console.log('Testing: disconnected mongoose')
      }
    } catch {
      // mongoose not installed or used
    }

    // Prisma
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-require-imports
      const { PrismaClient } = require('@prisma/client')
      // Currently, we don't have a direct reference to the user's Prisma instance,
      // but developers typically export it or handle it. For Exis zero-config,
      // we might need to rely on the user for now unless we cache it similarly.
    } catch {
      // Prisma not used
    }

    // Redis
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { redis } = require('../integrations/redis') as any
      if (redis && typeof redis.quit === 'function') {
        console.log('Testing: disconnecting redis')
        await redis.quit()
      }
    } catch {
      // Redis not used
    }

    // Call the built-in graceful shutdown which cleans up the queue,
    // cron jobs, database connections, and running servers.
    if (typeof app.close === 'function') {
      console.log('Testing: app.close()')
      await app.close()
      console.log('Testing: app.close() finished')
    }
  })

  return createTestApp(app)
}

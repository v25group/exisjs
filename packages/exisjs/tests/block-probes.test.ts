import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  blockSuspiciousProbes,
  blockProbes,
  DEFAULT_PROBE_PATTERNS,
  requestLogger,
} from '../src/middleware/middleware'
import { BlockProbes, Controller, Get, Server } from '../src/decorators'
import { createTestContext } from '../src/testing'
import { ExisRequest } from '../src/server/request'
import { ExisResponse } from '../src/server/response'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { defineBoundary } from '../src/router/boundary'

function createMockReqRes(path: string, method = 'GET') {
  const socket = new Socket()
  const rawReq = new IncomingMessage(socket)
  rawReq.url = path
  rawReq.method = method

  const rawRes = new ServerResponse(rawReq)
  let responseBody = ''
  let responseStatus = 200

  rawRes.writeHead = (status: number, headers?: any) => {
    responseStatus = status
    return rawRes
  }

  const req = new ExisRequest(rawReq, undefined as any, false, 1024 * 1024)
  const res = new ExisResponse(rawRes)
  res.req = req

  res.send = (data: any) => {
    responseBody = typeof data === 'string' ? data : JSON.stringify(data)
    res.statusCode = responseStatus
    return res
  }

  res.status = (code: number) => {
    responseStatus = code
    res.statusCode = code
    return res
  }

  return {
    req,
    res,
    rawReq,
    rawRes,
    getBody: () => responseBody,
    getStatus: () => responseStatus,
  }
}

describe('Security Scanner Noise Suppression & Blackhole Handler (blockSuspiciousProbes)', () => {
  it('should export blockSuspiciousProbes, blockProbes, and default patterns', () => {
    assert.strictEqual(typeof blockSuspiciousProbes, 'function')
    assert.strictEqual(typeof blockProbes, 'function')
    assert.ok(Array.isArray(DEFAULT_PROBE_PATTERNS))
    assert.ok(DEFAULT_PROBE_PATTERNS.length > 5)
  })

  it('should pass normal non-probe requests through to next()', () => {
    const mw = blockSuspiciousProbes()
    const { req, res } = createMockReqRes('/api/users')
    let nextCalled = false

    mw(req, res, () => {
      nextCalled = true
    })

    assert.strictEqual(nextCalled, true)
    assert.strictEqual((req as any)._probeBlocked, undefined)
  })

  it('should intercept common .env probes with 404 empty blackhole', () => {
    const mw = blockSuspiciousProbes()
    const probePaths = [
      '/.env',
      '/.env.local',
      '/.env.production',
      '/.env.backup',
      '/api/.env',
      '/.env.save',
      '/.env.old',
    ]

    for (const path of probePaths) {
      const { req, res, getStatus, getBody } = createMockReqRes(path)
      let nextCalled = false

      mw(req, res, () => {
        nextCalled = true
      })

      assert.strictEqual(
        nextCalled,
        false,
        `Expected ${path} to be blackholed without calling next()`
      )
      assert.strictEqual(getStatus(), 404)
      assert.strictEqual(getBody(), '')
      assert.strictEqual((req as any)._probeBlocked, true)
      assert.strictEqual((req as any)._silentLog, true)
    }
  })

  it('should detect URL-encoded obfuscated probes (e.g. %2e%65%6e%76)', () => {
    const mw = blockSuspiciousProbes()
    const { req, res, getStatus, getBody } = createMockReqRes('/%2e%65%6e%76')
    let nextCalled = false

    mw(req, res, () => {
      nextCalled = true
    })

    assert.strictEqual(nextCalled, false)
    assert.strictEqual(getStatus(), 404)
    assert.strictEqual(getBody(), '')
    assert.strictEqual((req as any)._probeBlocked, true)
  })

  it('should intercept .git probes (e.g. /.git/HEAD, /.git/config)', () => {
    const mw = blockSuspiciousProbes()
    const { req, res, getStatus } = createMockReqRes('/.git/HEAD')
    let nextCalled = false

    mw(req, res, () => {
      nextCalled = true
    })

    assert.strictEqual(nextCalled, false)
    assert.strictEqual(getStatus(), 404)
    assert.strictEqual((req as any)._probeBlocked, true)
  })

  it('should intercept .DS_Store, phpinfo, and WordPress probes', () => {
    const mw = blockSuspiciousProbes()
    const probePaths = [
      '/.DS_Store',
      '/phpinfo.php',
      '/wp-config.php',
      '/wp-login.php',
      '/.aws/credentials',
    ]

    for (const path of probePaths) {
      const { req, res, getStatus } = createMockReqRes(path)
      let nextCalled = false

      mw(req, res, () => {
        nextCalled = true
      })

      assert.strictEqual(
        nextCalled,
        false,
        `Expected ${path} to be intercepted`
      )
      assert.strictEqual(getStatus(), 404)
      assert.strictEqual((req as any)._probeBlocked, true)
    }
  })

  it('should support custom statusCode and custom message', () => {
    const mw = blockSuspiciousProbes({
      statusCode: 403,
      message: 'Forbidden exploit probe',
    })
    const { req, res, getStatus, getBody } = createMockReqRes('/.env')

    mw(req, res, () => {})

    assert.strictEqual(getStatus(), 403)
    assert.strictEqual(getBody(), 'Forbidden exploit probe')
    assert.strictEqual((req as any)._probeBlocked, true)
  })

  it('should support custom probe patterns', () => {
    const mw = blockSuspiciousProbes({
      patterns: [/secret-backup\.tar\.gz/i, '/internal-debug'],
    })

    const {
      req: req1,
      res: res1,
      getStatus: getStatus1,
    } = createMockReqRes('/downloads/secret-backup.tar.gz')
    let next1 = false
    mw(req1, res1, () => {
      next1 = true
    })
    assert.strictEqual(next1, false)
    assert.strictEqual(getStatus1(), 404)

    const {
      req: req2,
      res: res2,
      getStatus: getStatus2,
    } = createMockReqRes('/internal-debug/test')
    let next2 = false
    mw(req2, res2, () => {
      next2 = true
    })
    assert.strictEqual(next2, false)
    assert.strictEqual(getStatus2(), 404)
  })

  it('should support exclude whitelist patterns', () => {
    const mw = blockSuspiciousProbes({
      exclude: ['/.well-known/security.txt', '/.env.example'],
    })

    const { req, res } = createMockReqRes('/.env.example')
    let nextCalled = false
    mw(req, res, () => {
      nextCalled = true
    })
    assert.strictEqual(nextCalled, true)
    assert.strictEqual((req as any)._probeBlocked, undefined)
  })

  it('should trigger onProbe callback with matched pattern', () => {
    let notified = false
    let matched: any = null

    const mw = blockSuspiciousProbes({
      onProbe: (_req, _res, pattern) => {
        notified = true
        matched = pattern
      },
    })

    const { req, res } = createMockReqRes('/.env')
    mw(req, res, () => {})

    assert.strictEqual(notified, true)
    assert.ok(matched)
  })

  it('should suppress logger warning in requestLogger when _probeBlocked or _silentLog is true', () => {
    let warnLogged = false
    const mockLogger = {
      level: 'info',
      info: () => {},
      warn: () => {
        warnLogged = true
      },
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
      silent: () => {},
      child: () => mockLogger,
    } as any

    const loggerMw = requestLogger(mockLogger)
    const probeMw = blockSuspiciousProbes({ silent: true })

    const { req, res, getStatus } = createMockReqRes('/.env')

    // Simulate pipeline: loggerMw -> probeMw
    loggerMw(req, res, () => {})
    probeMw(req, res, () => {})

    assert.strictEqual(getStatus(), 404)
    assert.strictEqual((req as any)._probeBlocked, true)
    assert.strictEqual((req as any)._silentLog, true)

    // Trigger onFinish callbacks in res
    for (const cb of res._onFinish) {
      cb()
    }

    assert.strictEqual(
      warnLogged,
      false,
      'Expected warning log to be suppressed for probe request'
    )
  })

  it('should work with defineBoundary and BoundaryConfig', () => {
    const boundary = defineBoundary({
      blockProbes: {
        statusCode: 403,
      },
    })
    assert.ok(boundary.blockProbes)
  })

  it('should work with @BlockProbes OOP controller decorator in createTestContext', async () => {
    @Controller('/secure')
    @BlockProbes({ statusCode: 403, message: 'Blackholed' })
    class SecureController {
      @Get('/data')
      getData() {
        return { ok: true }
      }

      @Get('/.env')
      getEnv() {
        return { secret: 'never_reached' }
      }
    }

    @Server({})
    class RootServer {
      async onStart(appInstance: any) {
        appInstance.registerControllers([SecureController])
      }
    }

    const testCtx = createTestContext(RootServer)

    // Normal route passes
    const resOk = await testCtx.get('/secure/data').execute()
    assert.strictEqual(resOk.status, 200)
    assert.deepStrictEqual(resOk.body, { ok: true })

    // Probe route on secure controller is blocked with 403 and never reaches handler
    const resProbe = await testCtx.get('/secure/.env').execute()
    assert.strictEqual(resProbe.status, 403)
    assert.strictEqual(resProbe.body, 'Blackholed')
  })
})

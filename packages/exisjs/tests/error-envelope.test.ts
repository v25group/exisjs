import { describe, it } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import fs from 'node:fs'
import {
  categorizeError,
  generateErrorHint,
  stripInternalStackFrames,
  parseErrorLocation,
  buildCodeFrame,
  renderDevErrorToString,
  devErrorResponse,
} from '../src/error/overlay'

describe('Developer Error Envelopes (Clean Terminal DX)', () => {
  it('should categorize error types accurately', () => {
    assert.strictEqual(
      categorizeError(
        new Error('Missing required environment variable "DATABASE_URL"')
      ),
      'Environment Configuration Error'
    )
    assert.strictEqual(
      categorizeError(
        new Error(
          'Field "status" expects tex.enum([...]), but received undefined'
        )
      ),
      'Validation Schema Error'
    )
    assert.strictEqual(
      categorizeError(
        new Error('Duplicate route defined for /api/users on NativeRadixTree')
      ),
      'Route Configuration Error'
    )
    assert.strictEqual(
      categorizeError(
        new Error('Cannot resolve token "UserService" from Container')
      ),
      'Dependency Injection Error'
    )
    assert.strictEqual(
      categorizeError(new Error('beforeHandle hook threw an error')),
      'Boundary & Middleware Error'
    )
    assert.strictEqual(
      categorizeError(new SyntaxError('Unexpected identifier "foo"')),
      'Syntax Error'
    )
    assert.strictEqual(
      categorizeError(new Error("Cannot find module './missing-service'")),
      'Module Import Error'
    )
    assert.strictEqual(
      categorizeError(
        new Error('listen EADDRINUSE: address already in use 0.0.0.0:4000')
      ),
      'Port Conflict Error'
    )
  })

  it('should generate actionable hints for common mistakes', () => {
    const hint1 = generateErrorHint(
      new Error('Missing required environment variable "JWT_SECRET"')
    )
    assert.ok(hint1?.includes('JWT_SECRET'))
    assert.ok(hint1?.includes('src/config/env.ts') || hint1?.includes('.env'))

    const hint2 = generateErrorHint(
      new Error(
        'Field "status" expects tex.enum(["admin", "user"]), but received undefined'
      )
    )
    assert.ok(hint2?.includes('default value') || hint2?.includes('optional()'))

    const hint3 = generateErrorHint(
      new Error("Cannot find module './auth/service'")
    )
    assert.ok(hint3?.includes('package.json') || hint3?.includes('import path'))

    const hint4 = generateErrorHint(
      new Error('listen EADDRINUSE: address already in use')
    )
    assert.ok(hint4?.includes('exis dev -p') || hint4?.includes('port'))
  })

  it('should strip internal Node.js runtime and framework stack frames', () => {
    const dummyStack = `Error: Something broke
    at Object.<anonymous> (z:/projects/my-app/src/http/users/route.ts:18:5)
    at Module._compile (node:internal/modules/cjs/loader:1500:14)
    at Object..js (node:internal/modules/cjs/loader:1550:10)
    at runHandlers (z:/projects/framework/exisjs/packages/exisjs/dist/router.js:45:10)
    at Object.<anonymous> (z:/projects/framework/exisjs/node_modules/tsx/dist/loader.js:100:12)`

    const stripped = stripInternalStackFrames(dummyStack)

    assert.strictEqual(stripped.length, 1)
    assert.ok(stripped[0].includes('src/http/users/route.ts:18:5'))
    assert.ok(!stripped.some((l) => l.includes('node:internal')))
    assert.ok(!stripped.some((l) => l.includes('tsx')))
    assert.ok(!stripped.some((l) => l.includes('dist/router.js')))
  })

  it('should extract location, parse location, and build code frame', () => {
    const testFile = path.join(__dirname, '.tmp-sample-route.ts')
    fs.writeFileSync(
      testFile,
      `import { route } from 'exisjs/router'\n\nexport const status = tex.enum(['active'])\n`,
      'utf-8'
    )

    try {
      const frame = buildCodeFrame(testFile, 3, 22)
      assert.ok(frame.includes('> 3 |'))
      assert.ok(frame.includes('tex.enum'))

      const err = new Error(
        'Field "status" expects tex.enum([active]), but received undefined'
      )
      err.stack = `Error: Field error\n    at Object.<anonymous> (${testFile}:3:22)`

      const parsed = parseErrorLocation(err)
      assert.strictEqual(parsed.line, 3)
      assert.strictEqual(parsed.column, 22)
      assert.strictEqual(parsed.title, 'Validation Schema Error')
      assert.ok(parsed.hint)

      const rendered = renderDevErrorToString(err)
      assert.ok(rendered.includes('Validation Schema Error'))
      assert.ok(rendered.includes('Hint:'))
      assert.ok(rendered.includes('tex.enum'))
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile)
      }
    }
  })

  it('should produce clean devErrorResponse payload', () => {
    const err = new Error('Missing required environment variable "PORT"')
    const res = devErrorResponse(err, 'src/config/env.ts') as any

    assert.strictEqual(res.success, false)
    assert.strictEqual(res.error.code, 'DEV_ERROR')
    assert.strictEqual(res.error.title, 'Environment Configuration Error')
    assert.strictEqual(res.error.file, 'src/config/env.ts')
    assert.ok(res.error.hint)
  })
})

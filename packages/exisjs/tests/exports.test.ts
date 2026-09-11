import test from 'node:test'
import assert from 'node:assert/strict'

// 1. Root core exports (exisjs)
import {
  exis,
  getActiveApp,
  defineConfig,
  parseEnv,
  loadEnv,
  CircuitBreaker,
} from '../src/index'

// 2. Validator exports (exisjs/validator)
import {
  tex,
  paginate,
  getPaginationSkip,
  type PaginationMeta,
  type PaginatedResult,
} from '../src/validator/index'

// 3. Middleware exports (exisjs/middleware)
import {
  fileUpload,
  fromExpress,
  timeout,
  cors,
  rateLimit,
} from '../src/middleware/middleware'

// 4. Database exports (exisjs/database)
import {
  registerDatabase,
  withTransaction,
  modernUpdateOptions,
  mongoPoolOptions,
  DatabaseManager,
} from '../src/database/index'

// 5. Response exports (exisjs/response)
import { success, error } from '../src/response/index'

test('Exports: root "exisjs" provides core runtime and config primitives', () => {
  assert.equal(typeof exis, 'function')
  assert.equal(typeof getActiveApp, 'function')
  assert.equal(typeof defineConfig, 'function')
  assert.equal(typeof parseEnv, 'function')
  assert.equal(typeof loadEnv, 'function')
  assert.equal(typeof CircuitBreaker, 'function')
})

test('Exports: "exisjs/validator" is the single source for tex, paginate, and getPaginationSkip', () => {
  assert.equal(typeof tex, 'object')
  assert.equal(typeof tex.pagination, 'function')
  assert.equal(typeof paginate, 'function')
  assert.equal(typeof getPaginationSkip, 'function')

  // Functional test
  const skip = getPaginationSkip({ page: 3, limit: 10 })
  assert.equal(skip.skip, 20)
  assert.equal(skip.limit, 10)

  const res = paginate(['item1'], 10, { page: 1, limit: 5 })
  assert.equal(res.pagination.total, 10)
  assert.equal(res.pagination.totalPages, 2)
  assert.equal(res.pagination.hasNext, true)
})

test('Exports: "exisjs/middleware" is the single source for fileUpload, fromExpress, timeout, cors, rateLimit', () => {
  assert.equal(typeof fileUpload, 'function')
  assert.equal(typeof fileUpload.single, 'function')
  assert.equal(typeof fileUpload.array, 'function')
  assert.equal(typeof fileUpload.fields, 'function')
  assert.equal(typeof fileUpload.any, 'function')
  assert.equal(typeof fileUpload.none, 'function')
  assert.equal(typeof fromExpress, 'function')
  assert.equal(typeof timeout, 'function')
  assert.equal(typeof cors, 'function')
  assert.equal(typeof rateLimit, 'function')
})

test('Exports: "exisjs/database" is the single source for database lifecycle & transactions', () => {
  assert.equal(typeof registerDatabase, 'function')
  assert.equal(typeof withTransaction, 'function')
  assert.equal(typeof modernUpdateOptions, 'function')
  assert.equal(typeof mongoPoolOptions, 'function')
  assert.equal(typeof DatabaseManager, 'function')
})

test('Exports: "exisjs/response" is the single source for standard response envelopes (success, error)', () => {
  assert.equal(typeof success, 'function')
  assert.equal(typeof error, 'function')

  const s = success({ id: 1 }, 'Created')
  assert.equal(s.success, true)
  assert.equal(s.message, 'Created')

  const e = error('Failed', 'NOT_FOUND')
  assert.equal(e.success, false)
  assert.equal(e.error.code, 'NOT_FOUND')
})

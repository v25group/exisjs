import { test, describe, expect, createTestContext } from 'exisjs/testing'
import app from '../src/http/server'

describe('Book Native Tests', () => {
  // Magically boot the framework, inject dependencies, and cleanup on exit
  createTestContext(app)

  test('should pass a basic test', () => {
    expect(true).toBe(true)
  })
})

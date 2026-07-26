import { test, describe, expect, createTestContext } from 'exisjs/testing'
import { User } from '../src/models/User'
import app from '../src/http/server'

describe('User Model Native Tests', () => {
  // Magically boot the framework, inject models, and cleanup on exit
  createTestContext(app)

  test('should query database correctly', async () => {
    const users = await User.find().limit(1)
    
    // Assert that the array is returned (even if empty)
    expect(Array.isArray(users)).toBeTruthy()
  })
})

import { describe, test as it, expect } from 'exisjs/testing'
import { TexValidator } from '../index.js'

describe('Rust Validator Integration Tests', () => {
  it('Successfully validates correctly typed data', () => {
    const validator = new TexValidator(
      {
        name: 'string | min:3 | trim',
        age: 'number? | coerce',
        email: 'email | trim | lowercase | mask',
        password: 'password | min:8 | requireNumbers',
      },
      true
    ) // strict mode

    const result = validator.parse({
      name: '  John  ',
      age: '18', // Will be coerced!
      email: ' TEST@EXISJS.COM ',
      password: 'password123',
    })

    expect(result.name).toBe('John')
    expect(result.age).toBe(18)
    expect(result.email).toBe('te***@exisjs.com')
    expect(result.password).toBe('password123')
  })

  it('Fails on invalid password requirements', () => {
    const validator = new TexValidator({
      password: 'password | min:8 | requireNumbers',
    })

    expect(() => {
      validator.parse({ password: 'password' }) // No numbers!
    }).toThrow()
  })

  it('Fails strict mode when unknown field is provided', () => {
    const validator = new TexValidator(
      {
        name: 'string',
      },
      true
    )

    expect(() => {
      validator.parse({ name: 'John', extra: 'field' })
    }).toThrow()
  })
})

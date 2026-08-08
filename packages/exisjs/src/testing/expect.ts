import assert from 'node:assert'

export class Expectation {
  constructor(
    private readonly actual: any,
    private readonly isNot = false
  ) {}

  get not(): Expectation {
    return new Expectation(this.actual, !this.isNot)
  }

  // --- Equality ---

  toBe(expected: any): void {
    if (this.isNot) {
      assert.notStrictEqual(this.actual, expected)
    } else {
      assert.strictEqual(this.actual, expected)
    }
  }

  toEqual(expected: any): void {
    if (this.isNot) {
      assert.notDeepEqual(this.actual, expected)
    } else {
      assert.deepEqual(this.actual, expected)
    }
  }

  toStrictEqual(expected: any): void {
    if (this.isNot) {
      assert.notDeepStrictEqual(this.actual, expected)
    } else {
      assert.deepStrictEqual(this.actual, expected)
    }
  }

  toMatchObject(expected: any): void {
    const isObject = (o: any) => o != null && typeof o === 'object'
    const contains = (actual: any, expected: any): boolean => {
      if (!isObject(actual) || !isObject(expected)) {
        if (expected && expected.__isAny) {
          return (
            Object(actual) instanceof expected.constructor ||
            typeof actual === typeof expected.constructor()
          )
        }
        if (expected && expected.__isStringContaining) {
          return (
            typeof actual === 'string' && actual.includes(expected.expected)
          )
        }
        return actual === expected
      }
      return Object.keys(expected).every((k) =>
        contains(actual[k], expected[k])
      )
    }

    if (this.isNot) {
      assert.ok(
        !contains(this.actual, expected),
        `Expected ${this.actual} not to match object ${expected}`
      )
    } else {
      assert.ok(
        contains(this.actual, expected),
        `Expected ${this.actual} to match object ${expected}`
      )
    }
  }

  // --- Truthiness ---

  toBeTruthy(): void {
    if (this.isNot) {
      assert.ok(!this.actual)
    } else {
      assert.ok(this.actual)
    }
  }

  toBeFalsy(): void {
    if (this.isNot) {
      assert.ok(this.actual)
    } else {
      assert.ok(!this.actual)
    }
  }

  toBeNull(): void {
    this.toBe(null)
  }

  toBeUndefined(): void {
    this.toBe(undefined)
  }

  toBeDefined(): void {
    if (this.isNot) {
      assert.strictEqual(this.actual, undefined)
    } else {
      assert.notStrictEqual(this.actual, undefined)
    }
  }

  // --- Numbers ---

  toBeGreaterThan(expected: number): void {
    if (this.isNot) {
      assert.ok(
        this.actual <= expected,
        `Expected ${this.actual} not to be greater than ${expected}`
      )
    } else {
      assert.ok(
        this.actual > expected,
        `Expected ${this.actual} to be greater than ${expected}`
      )
    }
  }

  toBeGreaterThanOrEqual(expected: number): void {
    if (this.isNot) {
      assert.ok(
        this.actual < expected,
        `Expected ${this.actual} not to be greater than or equal to ${expected}`
      )
    } else {
      assert.ok(
        this.actual >= expected,
        `Expected ${this.actual} to be greater than or equal to ${expected}`
      )
    }
  }

  toBeLessThan(expected: number): void {
    if (this.isNot) {
      assert.ok(
        this.actual >= expected,
        `Expected ${this.actual} not to be less than ${expected}`
      )
    } else {
      assert.ok(
        this.actual < expected,
        `Expected ${this.actual} to be less than ${expected}`
      )
    }
  }

  toBeCloseTo(expected: number, precision = 2): void {
    const pass = Math.abs(expected - this.actual) < Math.pow(10, -precision) / 2
    if (this.isNot) {
      assert.ok(!pass, `Expected ${this.actual} not to be close to ${expected}`)
    } else {
      assert.ok(pass, `Expected ${this.actual} to be close to ${expected}`)
    }
  }

  toBeLessThanOrEqual(expected: number): void {
    if (this.isNot) {
      assert.ok(
        this.actual > expected,
        `Expected ${this.actual} not to be less than or equal to ${expected}`
      )
    } else {
      assert.ok(
        this.actual <= expected,
        `Expected ${this.actual} to be less than or equal to ${expected}`
      )
    }
  }

  // --- Types & Instances ---

  toBeInstanceOf(constructor: any): void {
    const isInstance = this.actual instanceof constructor
    if (this.isNot) {
      assert.strictEqual(
        isInstance,
        false,
        `Expected value not to be instance of ${constructor.name}`
      )
    } else {
      assert.strictEqual(
        isInstance,
        true,
        `Expected value to be instance of ${constructor.name}`
      )
    }
  }

  // --- Arrays / Strings ---

  toContain(item: any): void {
    const contains =
      Array.isArray(this.actual) || typeof this.actual === 'string'
        ? this.actual.includes(item)
        : false

    if (this.isNot) {
      assert.strictEqual(
        contains,
        false,
        `Expected ${this.actual} not to contain ${item}`
      )
    } else {
      assert.strictEqual(
        contains,
        true,
        `Expected ${this.actual} to contain ${item}`
      )
    }
  }

  toHaveLength(length: number): void {
    if (this.isNot) {
      assert.notStrictEqual(this.actual?.length, length)
    } else {
      assert.strictEqual(this.actual?.length, length)
    }
  }

  // --- Objects ---

  toHaveProperty(key: string | string[], value?: any): void {
    const keys = Array.isArray(key) ? key : key.split('.')
    let current = this.actual
    let hasProp = true

    for (const k of keys) {
      if (current === undefined || current === null || !(k in current)) {
        hasProp = false
        break
      }
      current = current[k]
    }

    if (this.isNot) {
      if (value !== undefined) {
        if (hasProp) {
          try {
            assert.notDeepStrictEqual(current, value)
          } catch {
            assert.fail(`Expected property ${key} not to equal ${value}`)
          }
        }
      } else {
        assert.strictEqual(
          hasProp,
          false,
          `Expected object not to have property ${key}`
        )
      }
    } else {
      assert.strictEqual(
        hasProp,
        true,
        `Expected object to have property ${key}`
      )
      if (value !== undefined) {
        assert.deepStrictEqual(current, value)
      }
    }
  }

  // --- Functions ---

  toThrow(expected?: any): void {
    if (typeof this.actual !== 'function') {
      assert.fail('Expected value must be a function to use toThrow')
    }

    let threw = false
    let error: any
    try {
      this.actual()
    } catch (e) {
      threw = true
      error = e
    }

    if (this.isNot) {
      if (threw) {
        if (expected) {
          if (
            error instanceof Error &&
            (error.message.includes(expected) ||
              (expected instanceof RegExp && expected.test(error.message)))
          ) {
            assert.fail(
              `Expected function not to throw error matching ${expected}`
            )
          }
        } else {
          assert.fail(`Expected function not to throw, but it threw: ${error}`)
        }
      }
    } else {
      if (!threw) {
        assert.fail('Expected function to throw')
      }
      if (expected) {
        if (typeof expected === 'string') {
          assert.ok(
            error?.message?.includes(expected),
            `Expected error message to include ${expected}`
          )
        } else if (expected instanceof RegExp) {
          assert.ok(
            expected.test(error?.message),
            `Expected error message to match ${expected}`
          )
        } else if (typeof expected === 'function') {
          assert.ok(
            error instanceof expected,
            `Expected error to be instance of ${expected.name}`
          )
        }
      }
    }
  }

  toMatch(expected: RegExp | string): void {
    if (this.isNot) {
      if (expected instanceof RegExp) {
        assert.ok(
          !expected.test(this.actual),
          `Expected ${this.actual} not to match ${expected}`
        )
      } else {
        assert.ok(
          !String(this.actual).match(expected),
          `Expected ${this.actual} not to match ${expected}`
        )
      }
    } else {
      if (expected instanceof RegExp) {
        assert.ok(
          expected.test(this.actual),
          `Expected ${this.actual} to match ${expected}`
        )
      } else {
        assert.ok(
          String(this.actual).match(expected),
          `Expected ${this.actual} to match ${expected}`
        )
      }
    }
  }

  // --- Mocks ---

  toHaveBeenCalled(): void {
    const callCount = this.actual.mock?.callCount() || 0
    if (this.isNot) {
      assert.strictEqual(callCount, 0, `Expected mock not to have been called`)
    } else {
      assert.ok(callCount > 0, `Expected mock to have been called`)
    }
  }

  toHaveBeenCalledTimes(expected: number): void {
    const callCount = this.actual.mock?.callCount() || 0
    if (this.isNot) {
      assert.notStrictEqual(
        callCount,
        expected,
        `Expected mock not to have been called ${expected} times`
      )
    } else {
      assert.strictEqual(
        callCount,
        expected,
        `Expected mock to have been called ${expected} times`
      )
    }
  }

  toHaveBeenCalledWith(...expectedArgs: any[]): void {
    const calls = this.actual.mock?.calls || []

    const isObject = (o: any) => o != null && typeof o === 'object'
    const contains = (actual: any, expected: any): boolean => {
      if (!isObject(actual) || !isObject(expected)) {
        if (expected && expected.__isAny) {
          return (
            Object(actual) instanceof expected.constructor ||
            typeof actual === typeof expected.constructor()
          )
        }
        if (expected && expected.__isStringContaining) {
          return (
            typeof actual === 'string' && actual.includes(expected.expected)
          )
        }
        return actual === expected
      }
      return Object.keys(expected).every((k) =>
        contains(actual[k], expected[k])
      )
    }

    const hasCall = calls.some((call: any) => {
      const actualArgs = call.arguments
      if (actualArgs.length !== expectedArgs.length) return false
      return expectedArgs.every((expectedArg, i) =>
        contains(actualArgs[i], expectedArg)
      )
    })

    if (this.isNot) {
      assert.ok(
        !hasCall,
        `Expected mock not to have been called with ${JSON.stringify(expectedArgs)}`
      )
    } else {
      assert.ok(
        hasCall,
        `Expected mock to have been called with ${JSON.stringify(expectedArgs)}`
      )
    }
  }
  // --- Promises ---

  get resolves() {
    if (!(this.actual instanceof Promise)) {
      assert.fail('resolves must be used with a Promise')
    }
    const createResolves = (isNot: boolean) => ({
      toBe: async (expected: any) => {
        const val = await this.actual
        new Expectation(val, isNot).toBe(expected)
      },
      toEqual: async (expected: any) => {
        const val = await this.actual
        new Expectation(val, isNot).toEqual(expected)
      },
      toStrictEqual: async (expected: any) => {
        const val = await this.actual
        new Expectation(val, isNot).toStrictEqual(expected)
      },
      toBeUndefined: async () => {
        const val = await this.actual
        new Expectation(val, isNot).toBeUndefined()
      },
      get not() {
        return createResolves(!isNot)
      },
    })
    return createResolves(this.isNot)
  }

  get rejects() {
    if (!(this.actual instanceof Promise)) {
      assert.fail('rejects must be used with a Promise')
    }
    const createRejects = (isNot: boolean) => ({
      toThrow: async (expected?: any) => {
        let threw = false
        let error: any
        try {
          await this.actual
        } catch (e) {
          threw = true
          error = e
        }

        if (isNot) {
          if (threw) {
            if (expected) {
              if (
                error instanceof Error &&
                (error.message.includes(expected) ||
                  (expected instanceof RegExp && expected.test(error.message)))
              ) {
                assert.fail(
                  `Expected promise not to throw error matching ${expected}`
                )
              }
            } else {
              assert.fail('Expected promise not to throw')
            }
          }
        } else {
          if (!threw) {
            assert.fail('Expected promise to throw')
          }
          if (expected) {
            if (typeof expected === 'string') {
              assert.ok(
                error?.message?.includes(expected),
                `Expected error message to include ${expected}`
              )
            } else if (expected instanceof RegExp) {
              assert.ok(
                expected.test(error?.message),
                `Expected error message to match ${expected}`
              )
            } else if (typeof expected === 'function') {
              assert.ok(
                error instanceof expected,
                `Expected error to be instance of ${expected.name}`
              )
            }
          }
        }
      },
      get not() {
        return createRejects(!isNot)
      },
    })
    return createRejects(this.isNot)
  }
}

export function expect(actual: any): Expectation {
  return new Expectation(actual)
}

// Attach matchers
expect.stringContaining = (expected: string) => {
  return {
    __isStringContaining: true,
    expected,
  }
}
expect.any = (constructor: any) => {
  return {
    __isAny: true,
    constructor,
  }
}
expect.objectContaining = (expected: any) => {
  return {
    ...expected,
    __isObjectContaining: true,
  }
}
expect.fail = (message?: string) => {
  assert.fail(message)
}

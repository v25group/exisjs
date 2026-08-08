import { expect } from '../src/testing/expect'
import { describe, it } from '../src/testing'

describe('Exis Expectation Library', () => {
  it('toBe', () => {
    expect(1).toBe(1)
    expect('test').toBe('test')
    expect(1).not.toBe(2)
  })

  it('toEqual', () => {
    expect({ a: 1 }).toEqual({ a: 1 })
    expect([1, 2]).toEqual([1, 2])
    expect({ a: 1 }).not.toEqual({ a: 2 })
  })

  it('toBeTruthy / toBeFalsy', () => {
    expect(true).toBeTruthy()
    expect(1).toBeTruthy()
    expect(false).toBeFalsy()
    expect(0).toBeFalsy()
  })

  it('toBeNull / toBeUndefined', () => {
    expect(null).toBeNull()
    expect(undefined).toBeUndefined()
    expect(1).not.toBeNull()
    expect(1).not.toBeUndefined()
  })

  it('toBeInstanceOf', () => {
    class MyClass {}
    expect(new MyClass()).toBeInstanceOf(MyClass)
    expect(new MyClass()).not.toBeInstanceOf(String)
  })

  it('toContain', () => {
    expect([1, 2, 3]).toContain(2)
    expect('hello world').toContain('world')
    expect([1, 2, 3]).not.toContain(4)
  })

  it('toHaveLength', () => {
    expect([1, 2, 3]).toHaveLength(3)
    expect('test').toHaveLength(4)
    expect([1]).not.toHaveLength(2)
  })

  it('toHaveProperty', () => {
    const obj = { a: { b: 2 } }
    expect(obj).toHaveProperty('a')
    expect(obj).toHaveProperty('a.b')
    expect(obj).toHaveProperty(['a', 'b'])
    expect(obj).toHaveProperty('a.b', 2)
    expect(obj).not.toHaveProperty('c')
    expect(obj).not.toHaveProperty('a.b', 3)
  })

  it('toThrow', () => {
    expect(() => {
      throw new Error('fail')
    }).toThrow()
    expect(() => {
      throw new Error('fail')
    }).toThrow('fail')
    expect(() => {}).not.toThrow()
  })

  it('resolves.toBe / toEqual', async () => {
    await expect(Promise.resolve(1)).resolves.toBe(1)
    await expect(Promise.resolve({ a: 1 })).resolves.toEqual({ a: 1 })
    await expect(Promise.resolve(1)).resolves.not.toBe(2)
  })

  it('rejects.toThrow', async () => {
    await expect(Promise.reject(new Error('fail'))).rejects.toThrow()
    await expect(Promise.reject(new Error('fail'))).rejects.toThrow('fail')
    await expect(Promise.reject(new Error('fail'))).rejects.not.toThrow(
      'success'
    )
  })
})

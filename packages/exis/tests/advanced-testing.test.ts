import { test, expect, ex } from '../src/testing'

test('snapshot testing', () => {
  const result = {
    message: 'Hello World',
    status: 200,
    data: [1, 2, 3],
  }
  expect(result).toMatchSnapshot()
})

test('inline snapshot testing', () => {
  const result = 'inline test string'
  expect(result).toMatchInlineSnapshot()
})

test.each([
  [1, 2, 3],
  [2, 3, 5],
  [5, 5, 10],
])('test.each %d + %d = %d', (a, b, expected) => {
  expect(a + b).toBe(expected)
})

test('timers testing', () => {
  ex.useFakeTimers()
  const date = new Date(2020, 1, 1)
  ex.setSystemTime(date)
  expect(new Date().getTime()).toBe(date.getTime())
  ex.useRealTimers()
})

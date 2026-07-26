import { test, expect, ex } from '../src/testing'

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

import { describe, it, expect } from '../src/testing'
import {
  parseCronExpression,
  isValidCron,
  getNextCronDate,
} from '../src/cron/parser'
import { CronExpression, every } from '../src/cron/expressions'

describe('Cron Parser & Expressions Engine', () => {
  describe('Cron Expression Syntax Parsing', () => {
    it('parses standard 5-field cron patterns correctly', () => {
      const parsed = parseCronExpression('*/15 2 1 * 1-5')
      expect(parsed.hasSeconds).toBe(false)
      expect(Array.from(parsed.minutes)).toEqual([0, 15, 30, 45])
      expect(Array.from(parsed.hours)).toEqual([2])
      expect(Array.from(parsed.daysOfMonth)).toEqual([1])
      expect(parsed.months.size).toBe(12) // all months
      expect(Array.from(parsed.daysOfWeek)).toEqual([1, 2, 3, 4, 5])
    })

    it('parses 6-field cron patterns with seconds', () => {
      const parsed = parseCronExpression('*/10 0 12 * * *')
      expect(parsed.hasSeconds).toBe(true)
      expect(Array.from(parsed.seconds)).toEqual([0, 10, 20, 30, 40, 50])
      expect(Array.from(parsed.minutes)).toEqual([0])
      expect(Array.from(parsed.hours)).toEqual([12])
    })

    it('expands standard macros (@daily, @hourly, @midnight)', () => {
      const daily = parseCronExpression('@daily')
      expect(Array.from(daily.minutes)).toEqual([0])
      expect(Array.from(daily.hours)).toEqual([0])

      const hourly = parseCronExpression('@hourly')
      expect(Array.from(hourly.minutes)).toEqual([0])
      expect(hourly.hours.size).toBe(24)
    })

    it('validates valid and invalid cron expressions via isValidCron', () => {
      expect(isValidCron('0 0 * * *')).toBe(true)
      expect(isValidCron('*/5 * * * * *')).toBe(true)
      expect(isValidCron('@monthly')).toBe(true)
      expect(isValidCron('invalid-cron-string')).toBe(false)
      expect(isValidCron('60 * * * *')).toBe(false)
      expect(isValidCron('0 25 * * *')).toBe(false)
    })
  })

  describe('every() Human Duration Converter', () => {
    it('converts human duration strings into standard cron expressions', () => {
      expect(every('1 second')).toBe(CronExpression.EVERY_SECOND)
      expect(every('5 seconds')).toBe('*/5 * * * * *')
      expect(every('10s')).toBe('*/10 * * * * *')
      expect(every('1 minute')).toBe(CronExpression.EVERY_MINUTE)
      expect(every('5 minutes')).toBe('*/5 * * * *')
      expect(every('15min')).toBe('*/15 * * * *')
      expect(every('1 hour')).toBe(CronExpression.EVERY_HOUR)
      expect(every('2 hours')).toBe('0 */2 * * *')
      expect(every('1 day')).toBe(CronExpression.EVERY_DAY_AT_MIDNIGHT)
      expect(every('1 week')).toBe(CronExpression.EVERY_WEEK)
    })

    it('throws on invalid duration strings', () => {
      expect(() => every('unknown-duration')).toThrow(/Invalid duration string/)
    })
  })

  describe('Next Run Calculation & Timezone Precision', () => {
    it('accurately computes next run for hourly cron', () => {
      const from = new Date(Date.UTC(2026, 0, 1, 10, 15, 0)) // 2026-01-01 10:15:00 UTC
      const next = getNextCronDate('0 * * * *', from, 'UTC')
      expect(next.getUTCHours()).toBe(11)
      expect(next.getUTCMinutes()).toBe(0)
      expect(next.getUTCSeconds()).toBe(0)
    })

    it('accurately computes next run for midnight cron', () => {
      const from = new Date(Date.UTC(2026, 0, 1, 23, 30, 0))
      const next = getNextCronDate('0 0 * * *', from, 'UTC')
      expect(next.getUTCDate()).toBe(2)
      expect(next.getUTCHours()).toBe(0)
      expect(next.getUTCMinutes()).toBe(0)
    })

    it('respects IANA timezones (e.g. Asia/Kolkata)', () => {
      // 2026-01-01 18:00:00 UTC is 23:30:00 IST (+05:30)
      // Next midnight in IST is 2026-01-01 18:30:00 UTC (00:00:00 IST on Jan 2)
      const from = new Date(Date.UTC(2026, 0, 1, 18, 0, 0))
      const next = getNextCronDate('0 0 * * *', from, 'Asia/Kolkata')
      expect(next.toISOString()).toBe('2026-01-01T18:30:00.000Z')
    })
  })
})

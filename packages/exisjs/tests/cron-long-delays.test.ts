import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '../src/testing/index'
import { App } from '../src/server/app'
import { getNextCronDate } from '../src/cron/parser'
import { formatLoggedError } from '../src/utils/logger'

const MAX_TIMER_MS = 2_147_483_647
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// B55: a delay longer than a timer can hold became 1 ms, so the job ran
// many times a second.
describe('Cron delays longer than 24.8 days (B55)', () => {
  let app: App
  let delays: number[]
  let realSetTimeout: typeof setTimeout
  let overflowWarnings: number
  const onWarning = (w: Error) => {
    if (w.name === 'TimeoutOverflowWarning') overflowWarnings++
  }

  beforeEach(() => {
    app = new App()
    delays = []
    overflowWarnings = 0
    realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((fn: any, ms?: number, ...args: any[]) => {
      delays.push(ms ?? 0)
      return realSetTimeout(fn, ms, ...args)
    }) as any
    process.on('warning', onWarning)
  })

  afterEach(() => {
    globalThis.setTimeout = realSetTimeout
    process.off('warning', onWarning)
    app.cron.stopAll()
  })

  it('does not run a 40-day interval job early', async () => {
    let runs = 0
    const job = app.cron.schedule({
      name: 'forty-days',
      interval: 40 * 24 * 60 * 60 * 1000,
      run: () => {
        runs++
      },
    })
    // Jobs don't start on their own under NODE_ENV=test
    job.start()

    await sleep(50)

    expect(runs).toBe(0)
    expect(Math.max(...delays)).toBe(MAX_TIMER_MS)
    expect(overflowWarnings).toBe(0)
    expect(job.getStats().nextRun!.getTime()).toBeGreaterThan(
      Date.now() + 39 * 24 * 60 * 60 * 1000
    )
  })

  it('does not run a schedule years away early', async () => {
    let runs = 0
    // 29 February: the next one is at least about a year away
    const job = app.cron.schedule('leap-day', '0 0 29 2 *', () => {
      runs++
    })
    job.start()

    await sleep(50)

    expect(runs).toBe(0)
    expect(delays.every((d) => d <= MAX_TIMER_MS)).toBe(true)
    expect(overflowWarnings).toBe(0)
    expect(job.getStats().nextRun!.getUTCDate()).toBe(29)
  })
})

// B57: a fixed 12-hour jump over wrong days could land past the matching
// hour of the right day, so the run moved a whole month (or week) later.
describe('Next run for day-restricted patterns (B57)', () => {
  it('a monthly job in Asia/Kolkata runs on the next 1st', () => {
    const from = new Date('2026-11-13T01:57:28Z') // 07:27 in India
    const next = getNextCronDate('30 3 1 * *', from, 'Asia/Kolkata')
    expect(next.toISOString()).toBe('2026-11-30T22:00:00.000Z')
  })

  it('a monthly job in UTC started after its hour runs on the next 1st', () => {
    const from = new Date('2026-11-29T05:00:00Z')
    const next = getNextCronDate('30 3 1 * *', from, 'UTC')
    expect(next.toISOString()).toBe('2026-12-01T03:30:00.000Z')
  })

  it('a weekly job runs on the next matching weekday', () => {
    const from = new Date('2026-11-15T20:00:00Z') // Sunday evening
    const next = getNextCronDate('0 9 * * 1', from, 'UTC')
    expect(next.toISOString()).toBe('2026-11-16T09:00:00.000Z')
  })

  it('a yearly job runs on the next 1 January', () => {
    const from = new Date('2026-06-10T18:45:00Z')
    const next = getNextCronDate('0 0 1 1 *', from, 'Asia/Kolkata')
    expect(next.toISOString()).toBe('2026-12-31T18:30:00.000Z')
  })

  it('midnight on the day daylight saving starts', () => {
    // New York moves to EDT at 02:00 on 2026-03-08
    const from = new Date('2026-03-07T12:00:00Z')
    expect(
      getNextCronDate('0 0 * * *', from, 'America/New_York').toISOString()
    ).toBe('2026-03-08T05:00:00.000Z')
    expect(
      getNextCronDate(
        '0 0 * * *',
        new Date('2026-03-08T06:00:00Z'),
        'America/New_York'
      ).toISOString()
    ).toBe('2026-03-09T04:00:00.000Z')
  })

  it('the day daylight saving ends', () => {
    // New York moves back to EST at 02:00 on 2026-11-01
    const from = new Date('2026-10-31T20:00:00Z')
    expect(
      getNextCronDate('30 3 1 * *', from, 'America/New_York').toISOString()
    ).toBe('2026-11-01T08:30:00.000Z')
  })
})

// B53: cron errors were logged as a string under `err`, and pretty logs hid
// `err` on every line that wasn't a request.
describe('Cron error logging (B53)', () => {
  it('logs the error object, so the message and stack reach the log', async () => {
    const app = new App()
    const logged: any[] = []
    const real = app.log
    app.log = {
      ...real,
      error: (obj: any) => logged.push(obj),
      warn: () => {},
      info: () => {},
    } as any

    const job = app.cron.schedule({
      name: 'fails',
      schedule: '0 0 1 1 *',
      autoStart: false,
      run: () => {
        throw new Error('DMS login refused')
      },
    })
    await job.trigger()

    expect(logged[0].err).toBeInstanceOf(Error)
    expect(logged[0].err.message).toBe('DMS login refused')
    expect(job.getStats().lastError).toBe('DMS login refused')
    app.cron.stopAll()
  })

  it('pretty logs show the message and the first stack frames', () => {
    const err = new Error('DMS login refused')
    const out = formatLoggedError(err)
    expect(out).toContain('DMS login refused')
    expect(out).toContain('at ')
    expect(formatLoggedError('plain text')).toContain('plain text')
    expect(formatLoggedError(undefined)).toBe('')
  })
})

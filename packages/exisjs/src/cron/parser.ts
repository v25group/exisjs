const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const DAY_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

export interface ParsedCronPattern {
  hasSeconds: boolean
  seconds: Set<number>
  minutes: Set<number>
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
}

/**
 * Parses a single cron field expression (e.g. `*`, `1,2,5`, `10-20`, `* /5`, `L`, `W`).
 */
function parseField(
  field: string,
  min: number,
  max: number,
  aliases?: Record<string, number>
): Set<number> {
  const result = new Set<number>()
  const str = field.trim().toLowerCase()

  if (!str) return result

  let normalized = str
  if (aliases) {
    for (const [alias, val] of Object.entries(aliases)) {
      normalized = normalized.replace(new RegExp(alias, 'g'), String(val))
    }
  }

  const parts = normalized.split(',')
  for (const part of parts) {
    if (part === '*' || part === '?') {
      for (let i = min; i <= max; i++) result.add(i)
    } else if (part.includes('/')) {
      const [rangeStr, stepStr] = part.split('/')
      const step = parseInt(stepStr, 10)
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid cron step: ${part}`)
      }

      let start = min
      let end = max
      if (rangeStr && rangeStr !== '*' && rangeStr !== '?') {
        if (rangeStr.includes('-')) {
          const [s, e] = rangeStr.split('-').map((v) => parseInt(v, 10))
          start = isNaN(s) ? min : s
          end = isNaN(e) ? max : e
        } else {
          start = parseInt(rangeStr, 10)
        }
      }

      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) result.add(i)
      }
    } else if (part.includes('-')) {
      const [sStr, eStr] = part.split('-')
      const s = parseInt(sStr, 10)
      const e = parseInt(eStr, 10)
      if (isNaN(s) || isNaN(e) || s > e || s < min || e > max) {
        throw new Error(
          `Invalid cron range: ${part} (min: ${min}, max: ${max})`
        )
      }
      for (let i = s; i <= e; i++) result.add(i)
    } else {
      const val = parseInt(part, 10)
      if (isNaN(val) || val < min || val > max) {
        if (min === 0 && max === 6 && val === 7) {
          result.add(0)
        } else {
          throw new Error(
            `Invalid cron value: ${part} (expected ${min}-${max})`
          )
        }
      } else {
        result.add(val)
      }
    }
  }

  return result
}

/**
 * Parses a 5 or 6 field cron expression into a structured pattern object.
 */
export function parseCronExpression(expression: string): ParsedCronPattern {
  const trimmed = expression.trim()
  const exp = MACROS[trimmed] || trimmed
  const tokens = exp.split(/\s+/).filter(Boolean)

  if (tokens.length !== 5 && tokens.length !== 6) {
    throw new Error(
      `Invalid cron expression "${expression}". Expected 5 or 6 fields, received ${tokens.length}.`
    )
  }

  const hasSeconds = tokens.length === 6
  let secStr = '0'
  let minStr: string
  let hourStr: string
  let domStr: string
  let monthStr: string
  let dowStr: string

  if (hasSeconds) {
    ;[secStr, minStr, hourStr, domStr, monthStr, dowStr] = tokens
  } else {
    ;[minStr, hourStr, domStr, monthStr, dowStr] = tokens
  }

  return {
    hasSeconds,
    seconds: parseField(secStr, 0, 59),
    minutes: parseField(minStr, 0, 59),
    hours: parseField(hourStr, 0, 23),
    daysOfMonth: parseField(domStr, 1, 31),
    months: parseField(monthStr, 1, 12, MONTH_NAMES),
    daysOfWeek: parseField(dowStr, 0, 6, DAY_NAMES),
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(timezone?: string): Intl.DateTimeFormat | null {
  if (!timezone || timezone.toUpperCase() === 'UTC') return null
  let fmt = formatterCache.get(timezone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
      hour12: false,
    })
    formatterCache.set(timezone, fmt)
  }
  return fmt
}

const dayOfWeekMap: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/**
 * Computes date parts in a given IANA timezone using cached formatter.
 */
function getDatePartsInTimezone(
  date: Date,
  timezone?: string
): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  dayOfWeek: number
} {
  const formatter = getFormatter(timezone)
  if (!formatter) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      dayOfWeek: date.getUTCDay(),
    }
  }

  const parts = formatter.formatToParts(date)
  const map: Record<string, string> = {}
  for (const part of parts) {
    map[part.type] = part.value
  }

  let hour = parseInt(map.hour, 10)
  if (hour === 24) hour = 0

  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour,
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    dayOfWeek: dayOfWeekMap[map.weekday] ?? date.getUTCDay(),
  }
}

/**
 * Validates whether a cron expression is syntactically valid.
 */
export function isValidCron(expression: string): boolean {
  try {
    parseCronExpression(expression)
    return true
  } catch {
    return false
  }
}

/**
 * Calculates the next occurrence Date for a cron pattern from a base date.
 */
export function getNextCronDate(
  pattern: ParsedCronPattern | string,
  fromDate = new Date(),
  timezone?: string
): Date {
  const parsed =
    typeof pattern === 'string' ? parseCronExpression(pattern) : pattern

  const current = new Date(fromDate.getTime())
  if (parsed.hasSeconds) {
    current.setUTCSeconds(current.getUTCSeconds() + 1, 0)
  } else {
    current.setUTCSeconds(0, 0)
    current.setUTCMinutes(current.getUTCMinutes() + 1)
  }

  const stepMs = parsed.hasSeconds ? 1000 : 60 * 1000
  const maxIterations = 5 * 365 * 24 * 60 // 5 years

  for (let i = 0; i < maxIterations; i++) {
    const parts = getDatePartsInTimezone(current, timezone)

    if (!parsed.months.has(parts.month)) {
      current.setTime(current.getTime() + 12 * 60 * 60 * 1000)
      continue
    }

    const domMatch = parsed.daysOfMonth.has(parts.day)
    const dowMatch = parsed.daysOfWeek.has(parts.dayOfWeek)
    if (!domMatch || !dowMatch) {
      current.setTime(current.getTime() + 12 * 60 * 60 * 1000)
      continue
    }

    if (!parsed.hours.has(parts.hour)) {
      current.setTime(current.getTime() + 60 * 60 * 1000)
      // Align to start of hour in current timezone
      const hourPart = getDatePartsInTimezone(current, timezone)
      if (hourPart.minute !== 0) {
        current.setTime(current.getTime() - hourPart.minute * 60 * 1000)
      }
      continue
    }

    if (!parsed.minutes.has(parts.minute)) {
      current.setTime(current.getTime() + stepMs)
      continue
    }

    if (parsed.hasSeconds) {
      if (!parsed.seconds.has(parts.second)) {
        current.setTime(current.getTime() + 1000)
        continue
      }
    }

    return current
  }

  throw new Error('Unable to find next cron execution within 5-year window')
}

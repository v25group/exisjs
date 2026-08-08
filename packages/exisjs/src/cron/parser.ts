export function parseCronExpression(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression: "${expression}". Expected 5 parts (min hr dom mth dow)`
    )
  }

  const [min, hr, dom, mth, dow] = parts

  return (
    matchCronPart(min, date.getMinutes()) &&
    matchCronPart(hr, date.getHours()) &&
    matchCronPart(dom, date.getDate()) &&
    matchCronPart(mth, date.getMonth() + 1) && // JS months are 0-indexed
    matchCronPart(dow, date.getDay())
  )
}

function matchCronPart(part: string, value: number): boolean {
  if (part === '*') return true

  // Support lists e.g., "1,5,10"
  if (part.includes(',')) {
    return part.split(',').some((p) => matchCronPart(p, value))
  }

  // Support steps e.g., "*/5" or "10/2"
  if (part.includes('/')) {
    const [rangeStr, stepStr] = part.split('/')
    const step = parseInt(stepStr, 10)

    if (rangeStr === '*') {
      return value % step === 0
    }

    // Support range with steps e.g. "1-10/2"
    if (rangeStr.includes('-')) {
      const [startStr, endStr] = rangeStr.split('-')
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (value >= start && value <= end) {
        return (value - start) % step === 0
      }
      return false
    }

    // e.g., "10/2" -> value must be >= 10, and (value - 10) % 2 === 0
    const start = parseInt(rangeStr, 10)
    return value >= start && (value - start) % step === 0
  }

  // Support ranges e.g., "1-5"
  if (part.includes('-')) {
    const [startStr, endStr] = part.split('-')
    return value >= parseInt(startStr, 10) && value <= parseInt(endStr, 10)
  }

  // Exact match
  return parseInt(part, 10) === value
}

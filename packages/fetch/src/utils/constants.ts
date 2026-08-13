export const DEFAULT_VALIDATE_STATUS = (s: number): boolean =>
  s >= 200 && s < 300
export const DEFAULT_RETRY_ON: number[] = [408, 429, 500, 502, 503, 504]
export const DEFAULT_CACHE_TTL_MS = 60_000
/** Progress events are throttled to ~3/sec. */
export const PROGRESS_THROTTLE_MS = 333

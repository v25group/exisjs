import type { FetchRequestConfig } from '../types'

export function shouldAttachXSRF(
  cfg: FetchRequestConfig,
  url: string
): boolean {
  if (typeof cfg.withXSRFToken === 'function') {
    return cfg.withXSRFToken(cfg) ?? false
  }
  if (cfg.withXSRFToken === true) return true
  if (cfg.withXSRFToken === false) return false
  // Default: same-origin only
  if (typeof window === 'undefined') return false
  try {
    return new URL(url, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

export interface CircuitBreakerOptions {
  /** Maximum number of failures before the breaker opens */
  failureThreshold?: number
  /** Time to wait (in ms) before transitioning from OPEN to HALF-OPEN */
  resetTimeoutMs?: number
}

export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation, all requests pass
  OPEN = 'OPEN', // Failing, all requests instantly rejected
  HALF_OPEN = 'HALF_OPEN', // Testing recovery, one request allowed through
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CircuitBreakerError'
  }
}

export class CircuitBreaker {
  public state: CircuitState = CircuitState.CLOSED

  private failureThreshold: number
  private resetTimeoutMs: number

  private failureCount = 0
  private nextAttempt = 0
  private halfOpenProbeInFlight = false

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5
    this.resetTimeoutMs = options.resetTimeoutMs ?? 10000
  }

  /**
   * Executes the given async function through the circuit breaker.
   */
  async fire<T>(action: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() >= this.nextAttempt) {
        // Time to test recovery
        this.state = CircuitState.HALF_OPEN
        this.halfOpenProbeInFlight = true
      } else {
        throw new CircuitBreakerError('Circuit breaker is OPEN')
      }
    } else if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenProbeInFlight) {
        // Only one probe is allowed to test recovery
        throw new CircuitBreakerError('Circuit breaker is OPEN')
      }
      this.halfOpenProbeInFlight = true
    }

    try {
      const result = await action()
      this.onSuccess()
      return result
    } catch (err) {
      this.onFailure()
      throw err
    }
  }

  private onSuccess(): void {
    this.failureCount = 0
    this.state = CircuitState.CLOSED
    this.halfOpenProbeInFlight = false
  }

  private onFailure(): void {
    this.failureCount++
    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN
      this.nextAttempt = Date.now() + this.resetTimeoutMs
    }
    this.halfOpenProbeInFlight = false
  }
}

/**
 * ProcessLifecycle
 *
 * Tracks and unregisters process-level event listeners (e.g. unhandledRejection,
 * uncaughtException, SIGINT, SIGTERM, custom process listeners) and background
 * interval timers registered during an ExisJS App's lifetime to prevent memory leaks,
 * zombie handles, and socket binding collisions across hot-reloads and restarts.
 */
export class ProcessLifecycle {
  private static trackedListeners: {
    event: string | symbol
    listener: (...args: any[]) => void
  }[] = []
  private static trackedIntervals = new Set<NodeJS.Timeout>()
  private static originalOn: typeof process.on | null = null
  private static originalAddListener: typeof process.addListener | null = null
  private static originalOnce: typeof process.once | null = null
  private static originalSetInterval: typeof globalThis.setInterval | null =
    null
  private static originalClearInterval: typeof globalThis.clearInterval | null =
    null
  private static isIntercepting = false

  public static startTracking(): void {
    if (this.isIntercepting) return
    this.isIntercepting = true

    this.originalOn = process.on
    this.originalAddListener = process.addListener
    this.originalOnce = process.once
    this.originalSetInterval = globalThis.setInterval
    this.originalClearInterval = globalThis.clearInterval

    process.on = function (
      event: string | symbol,
      listener: (...args: any[]) => void
    ) {
      ProcessLifecycle.trackedListeners.push({ event, listener })
      return ProcessLifecycle.originalOn!.call(process, event as any, listener)
    }

    process.addListener = function (
      event: string | symbol,
      listener: (...args: any[]) => void
    ) {
      ProcessLifecycle.trackedListeners.push({ event, listener })
      return ProcessLifecycle.originalAddListener!.call(
        process,
        event as any,
        listener
      )
    }

    process.once = function (
      event: string | symbol,
      listener: (...args: any[]) => void
    ) {
      const wrappedListener = function (this: any, ...args: any[]) {
        const index = ProcessLifecycle.trackedListeners.findIndex(
          (t) => t.listener === wrappedListener
        )
        if (index !== -1) ProcessLifecycle.trackedListeners.splice(index, 1)
        return listener.apply(this, args)
      }
      ProcessLifecycle.trackedListeners.push({
        event,
        listener: wrappedListener,
      })
      return ProcessLifecycle.originalOnce!.call(
        process,
        event as any,
        wrappedListener
      )
    }

    globalThis.setInterval = function (
      handler: (...args: any[]) => void,
      timeout?: number,
      ...args: any[]
    ): any {
      const timer = ProcessLifecycle.originalSetInterval!(
        handler,
        timeout,
        ...args
      )
      ProcessLifecycle.trackedIntervals.add(timer as any)
      return timer
    } as any

    globalThis.clearInterval = function (timer?: any): void {
      if (timer && typeof timer === 'object') {
        ProcessLifecycle.trackedIntervals.delete(timer)
      }
      return ProcessLifecycle.originalClearInterval!(timer)
    } as any
  }

  public static cleanup(): void {
    for (const { event, listener } of this.trackedListeners) {
      try {
        process.removeListener(event as any, listener)
      } catch {
        /* ignore */
      }
    }
    this.trackedListeners = []

    for (const timer of this.trackedIntervals) {
      try {
        if (this.originalClearInterval) {
          this.originalClearInterval(timer)
        } else {
          clearInterval(timer)
        }
      } catch {
        /* ignore */
      }
    }
    this.trackedIntervals.clear()
  }

  public static restore(): void {
    this.cleanup()
    if (this.isIntercepting) {
      if (this.originalOn) process.on = this.originalOn
      if (this.originalAddListener)
        process.addListener = this.originalAddListener
      if (this.originalOnce) process.once = this.originalOnce
      if (this.originalSetInterval)
        globalThis.setInterval = this.originalSetInterval
      if (this.originalClearInterval)
        globalThis.clearInterval = this.originalClearInterval
      this.isIntercepting = false
    }
  }
}

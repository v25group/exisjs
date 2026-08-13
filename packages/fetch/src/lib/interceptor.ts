import type {
  InterceptorHandler,
  InterceptorManager,
  InterceptorOptions,
} from '../types'

export class InterceptorManagerImpl<V> implements InterceptorManager<V> {
  private handlers: (InterceptorHandler<V> | null)[] = []

  public use(
    onFulfilled?: ((v: V) => V | Promise<V>) | null,
    onRejected?: ((e: unknown) => unknown) | null,
    options?: InterceptorOptions
  ): number {
    this.handlers.push({
      fulfilled: onFulfilled,
      rejected: onRejected,
      options,
    })
    return this.handlers.length - 1
  }

  public eject(id: number): void {
    if (this.handlers[id]) this.handlers[id] = null
  }

  public clear(): void {
    this.handlers = []
  }

  public forEach(fn: (h: InterceptorHandler<V>) => void): void {
    this.handlers.forEach((h) => {
      if (h !== null) fn(h)
    })
  }
}

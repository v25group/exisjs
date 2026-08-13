import { Cancel, isCancel } from './cancel-error'

export class CancelToken {
  public readonly promise: Promise<Cancel>
  private _resolveCancel!: (c: Cancel) => void
  private _reason?: Cancel
  private _abortController?: AbortController

  constructor(executor: (cancel: (message?: string) => void) => void) {
    this.promise = new Promise<Cancel>((resolve) => {
      this._resolveCancel = resolve
    })
    executor((message?: string) => {
      if (this._reason) return // already cancelled
      this._reason = new Cancel(message)
      this._resolveCancel(this._reason)
      this._abortController?.abort()
    })
  }

  public get reason(): Cancel | undefined {
    return this._reason
  }

  /** Throw immediately if this token has already been cancelled. */
  public throwIfRequested(): void {
    if (this._reason) throw this._reason
  }

  /** An AbortSignal that fires when this token is cancelled. */
  public get signal(): AbortSignal {
    if (!this._abortController) {
      this._abortController = new AbortController()
      if (this._reason) this._abortController.abort()
    }
    return this._abortController.signal
  }

  public static source(): {
    token: CancelToken
    cancel: (message?: string) => void
  } {
    let cancel!: (message?: string) => void
    const token = new CancelToken((c) => {
      cancel = c
    })
    return { token, cancel }
  }

  public static readonly isCancel = isCancel
}

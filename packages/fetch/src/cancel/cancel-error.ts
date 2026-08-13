export class Cancel {
  public readonly message?: string
  constructor(message?: string) {
    this.message = message
  }
  public toString(): string {
    return `Cancel${this.message ? `: ${this.message}` : ''}`
  }
}

export function isCancel(value: unknown): value is Cancel {
  return value instanceof Cancel
}

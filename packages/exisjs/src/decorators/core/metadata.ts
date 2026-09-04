export class MetadataEngine {
  /**
   * Retrieves metadata from a target.
   */
  static get<T = any>(target: any, key: symbol | string): T | undefined {
    return target[key]
  }

  /**
   * Sets metadata on a target.
   */
  static set(target: any, key: symbol | string, value: any): void {
    target[key] = value
  }

  /**
   * Initializes metadata on a target if it does not exist, then returns it.
   */
  static init<T>(target: any, key: symbol | string, defaultValue: T): T {
    if (target[key] === undefined) {
      target[key] = defaultValue
    }
    return target[key]
  }

  /**
   * Pushes a value to an array stored in metadata. Initializes the array if it doesn't exist.
   */
  static push(target: any, key: symbol | string, value: any): void {
    const arr = this.init<any[]>(target, key, [])
    arr.push(value)
  }

  /**
   * Merges an object into metadata. Initializes the object if it doesn't exist.
   */
  static merge(
    target: any,
    key: symbol | string,
    value: Record<string, any>
  ): void {
    const obj = this.init<Record<string, any>>(target, key, {})
    Object.assign(obj, value)
  }
}

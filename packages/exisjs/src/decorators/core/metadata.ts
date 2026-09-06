export class MetadataEngine {
  /**
   * Retrieves metadata from a target.
   */
  static get<T = any>(target: any, key: symbol | string): T | undefined {
    if (!target) return undefined
    return target[key]
  }

  /**
   * Sets metadata on a target.
   */
  static set(target: any, key: symbol | string, value: any): void {
    if (!target) return
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

export const CUSTOM_METADATA_STORE = Symbol.for('exisjs:custom_metadata')

/**
 * Assigns custom metadata to a class or route handler method under a specified key.
 *
 * Example:
 * ```ts
 * @SetMetadata('roles', ['admin', 'moderator'])
 * @Get('/admin')
 * adminDashboard() {}
 * ```
 */
export function SetMetadata<K = any, V = any>(
  key: K,
  value: V
): (
  target: any,
  propertyKey?: string | symbol | any,
  descriptor?: PropertyDescriptor | any
) => any {
  return function (
    target: any,
    propertyKey?: string | symbol | any,
    descriptor?: PropertyDescriptor | any
  ) {
    const isStandard =
      typeof propertyKey === 'object' &&
      propertyKey !== null &&
      'kind' in propertyKey

    let actualTarget: any
    if (isStandard) {
      // Stage 3 decorator
      actualTarget = target
    } else if (descriptor && descriptor.value) {
      // Method decorator (legacy)
      actualTarget = descriptor.value
    } else if (propertyKey && target[propertyKey]) {
      // Property/Method on prototype
      actualTarget = target[propertyKey]
    } else {
      // Class decorator
      actualTarget = target
    }

    if (!actualTarget[CUSTOM_METADATA_STORE]) {
      actualTarget[CUSTOM_METADATA_STORE] = new Map<any, any>()
    }
    actualTarget[CUSTOM_METADATA_STORE].set(key, value)

    if (actualTarget.prototype) {
      if (!actualTarget.prototype[CUSTOM_METADATA_STORE]) {
        actualTarget.prototype[CUSTOM_METADATA_STORE] = new Map<any, any>()
      }
      actualTarget.prototype[CUSTOM_METADATA_STORE].set(key, value)
    }

    return target
  }
}

/**
 * Reflector helper utility to inspect and retrieve custom metadata attached via `@SetMetadata`.
 */
export class Reflector {
  /**
   * Retrieve metadata for a specified key from a single target (class, handler, or function).
   */
  static get<TResult = any, TKey = any>(
    key: TKey,
    target: any
  ): TResult | undefined {
    if (!target) return undefined
    if (target[CUSTOM_METADATA_STORE] instanceof Map) {
      const val = target[CUSTOM_METADATA_STORE].get(key)
      if (val !== undefined) return val
    }
    if (
      target.prototype &&
      target.prototype[CUSTOM_METADATA_STORE] instanceof Map
    ) {
      const val = target.prototype[CUSTOM_METADATA_STORE].get(key)
      if (val !== undefined) return val
    }
    return undefined
  }

  /**
   * Retrieve metadata for a specified key from an array of targets, overriding previous values.
   * Priority is given to targets listed earlier in the array (e.g., method handler first, then class).
   */
  static getAllAndOverride<TResult = any, TKey = any>(
    key: TKey,
    targets: any[]
  ): TResult | undefined {
    for (const target of targets) {
      const val = this.get<TResult, TKey>(key, target)
      if (val !== undefined) {
        return val
      }
    }
    return undefined
  }

  /**
   * Retrieve metadata for a specified key across multiple targets and merge them together.
   * If array values, concatenates them. If object values, shallow-merges them.
   */
  static getAllAndMerge<TResult = any, TKey = any>(
    key: TKey,
    targets: any[]
  ): TResult | undefined {
    let mergedArray: any[] | undefined
    let mergedObject: Record<string, any> | undefined

    for (const target of targets) {
      const val = this.get<any, TKey>(key, target)
      if (val !== undefined) {
        if (Array.isArray(val)) {
          mergedArray = mergedArray ? [...mergedArray, ...val] : [...val]
        } else if (typeof val === 'object' && val !== null) {
          mergedObject = mergedObject ? { ...mergedObject, ...val } : { ...val }
        }
      }
    }

    return (mergedArray !== undefined ? mergedArray : mergedObject) as
      TResult | undefined
  }
}

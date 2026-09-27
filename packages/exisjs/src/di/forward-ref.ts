export interface ForwardReference<T = any> {
  forwardRef: () => T
}

/**
 * Creates a lazy forward reference for resolving circular dependencies between providers or modules.
 *
 * Example:
 * ```ts
 * @Injectable()
 * export class OrderService {
 *   constructor(
 *     @Inject(forwardRef(() => InventoryService))
 *     private inventoryService: InventoryService
 *   ) {}
 * }
 * ```
 */
export function forwardRef<T = any>(fn: () => T): ForwardReference<T> {
  return { forwardRef: fn }
}

/**
 * Checks if a value is a ForwardReference wrapper.
 */
export function isForwardRef(val: any): val is ForwardReference {
  return (
    val !== null &&
    typeof val === 'object' &&
    typeof val.forwardRef === 'function'
  )
}

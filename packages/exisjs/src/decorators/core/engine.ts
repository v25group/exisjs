/**
 * A utility to apply ExisJS decorators to standard JavaScript classes.
 * Enables 100% OOP support in pure JS without any transpilers.
 *
 * @example
 * ```javascript
 * import { Decorate, Controller, Get } from 'exisjs/decorators'
 *
 * class UsersController {
 *   list() {}
 * }
 *
 * export default Decorate(
 *   UsersController,
 *   [Controller('/users')],
 *   {
 *     list: [Get('/')]
 *   }
 * )
 * ```
 */
export function Decorate(
  target: any,
  classDecorators: any[] = [],
  methodDecorators: Record<string, any[]> = {}
) {
  const proto = target.prototype

  // 1. Apply Method & Parameter Decorators first
  // (Because class decorators like @Controller need to read method metadata)
  for (const [methodName, decorators] of Object.entries(methodDecorators)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, methodName)
    if (descriptor) {
      // Decorators should be applied in reverse order (bottom-up) to match TS
      const reversedDecorators = [...decorators].reverse()

      for (const decorator of reversedDecorators) {
        const result = decorator(proto, methodName, descriptor)
        if (result) {
          Object.defineProperty(proto, methodName, result)
        }
      }
    }
  }

  // 2. Apply Class Decorators
  const reversedClassDecorators = [...classDecorators].reverse()
  for (const decorator of reversedClassDecorators) {
    const result = decorator(target)
    if (result) {
      target = result
    }
  }

  return target
}

/**
 * A utility to bind parameter decorators to specific argument indices in pure JS.
 * Since JS lacks compiler support for parameter indices, you must manually specify which argument index the decorator applies to.
 *
 * @example
 * ```javascript
 * import { Decorate, BindParam, Body } from 'exisjs/decorators'
 *
 * class UsersController {
 *   create(body) {}
 * }
 *
 * export default Decorate(UsersController, [], {
 *   create: [
 *     BindParam(0, Body()) // Applies @Body() to the 0th argument (body)
 *   ]
 * })
 * ```
 */
export function BindParam(
  index: number,
  paramDecorator: (
    target: any,
    propertyKey: string | symbol,
    index: number
  ) => void
) {
  return function (
    target: any,
    propertyKey: string | symbol,
    _descriptor?: PropertyDescriptor
  ) {
    paramDecorator(target, propertyKey, index)
  }
}

import { CATCH_EXCEPTIONS_METADATA } from './constants'
import { MetadataEngine } from './core/metadata'

export interface ArgumentsHost {
  req: any
  res: any
  next: any
  switchToHttp?: () => {
    getRequest: () => any
    getResponse: () => any
    getNext: () => any
  }
}

/**
 * Interface defining an Exception Filter.
 */
export interface ExceptionFilter<T = any> {
  catch(exception: T, host: ArgumentsHost): void | Promise<void>
}

/**
 * Defines the exception types handled by an Exception Filter.
 * If empty, the filter catches all unhandled exceptions.
 *
 * @example
 * ```ts
 * @Catch(HttpException)
 * export class HttpExceptionFilter implements ExceptionFilter {
 *   catch(exception: HttpException, host: ArgumentsHost) {
 *     const { res } = host
 *     res.status(exception.statusCode).json({
 *       statusCode: exception.statusCode,
 *       message: exception.message,
 *       timestamp: new Date().toISOString(),
 *     })
 *   }
 * }
 * ```
 */
export function Catch(...exceptions: any[]): ClassDecorator {
  return function (target: any) {
    MetadataEngine.set(
      target.prototype || target,
      CATCH_EXCEPTIONS_METADATA,
      exceptions
    )
  }
}

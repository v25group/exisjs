import { BadRequestException } from '../error'
import { PIPES_METADATA } from './constants'
import { MetadataEngine } from './core/metadata'

export interface ArgumentMetadata {
  type: 'body' | 'query' | 'param' | 'custom' | 'header' | string
  metatype?: any
  data?: string
}

export interface PipeTransform<T = any, R = any> {
  transform(value: T, metadata?: ArgumentMetadata): R | Promise<R>
}

export interface ParseIntPipeOptions {
  errorHttpStatusCode?: number
  exceptionFactory?: (error: string) => any
}

export class ParseIntPipe implements PipeTransform<string | number, number> {
  constructor(private options?: ParseIntPipeOptions) {}

  transform(value: string | number, metadata?: ArgumentMetadata): number {
    if (typeof value === 'number') {
      if (Number.isNaN(value) || !Number.isFinite(value)) {
        throw this.createException(metadata?.data || 'value')
      }
      return Math.trunc(value)
    }

    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed === '' || !/^-?\d+$/.test(trimmed)) {
        throw this.createException(metadata?.data || 'value')
      }
      const parsed = parseInt(trimmed, 10)
      if (Number.isNaN(parsed)) {
        throw this.createException(metadata?.data || 'value')
      }
      return parsed
    }

    throw this.createException(metadata?.data || 'value')
  }

  private createException(paramName: string) {
    const msg = `Validation failed (numeric string is expected for '${paramName}')`
    if (this.options?.exceptionFactory) {
      return this.options.exceptionFactory(msg)
    }
    const status = this.options?.errorHttpStatusCode || 400
    return new BadRequestException(msg, { statusCode: status })
  }
}

export interface ParseFloatPipeOptions {
  errorHttpStatusCode?: number
  exceptionFactory?: (error: string) => any
}

export class ParseFloatPipe implements PipeTransform<string | number, number> {
  constructor(private options?: ParseFloatPipeOptions) {}

  transform(value: string | number, metadata?: ArgumentMetadata): number {
    if (typeof value === 'number') {
      if (Number.isNaN(value) || !Number.isFinite(value)) {
        throw this.createException(metadata?.data || 'value')
      }
      return value
    }

    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed === '' || Number.isNaN(Number(trimmed))) {
        throw this.createException(metadata?.data || 'value')
      }
      const parsed = parseFloat(trimmed)
      if (Number.isNaN(parsed)) {
        throw this.createException(metadata?.data || 'value')
      }
      return parsed
    }

    throw this.createException(metadata?.data || 'value')
  }

  private createException(paramName: string) {
    const msg = `Validation failed (numeric float string is expected for '${paramName}')`
    if (this.options?.exceptionFactory) {
      return this.options.exceptionFactory(msg)
    }
    const status = this.options?.errorHttpStatusCode || 400
    return new BadRequestException(msg, { statusCode: status })
  }
}

export interface ParseBoolPipeOptions {
  errorHttpStatusCode?: number
  exceptionFactory?: (error: string) => any
}

export class ParseBoolPipe implements PipeTransform<any, boolean> {
  constructor(private options?: ParseBoolPipeOptions) {}

  transform(value: any, metadata?: ArgumentMetadata): boolean {
    if (value === true || value === 'true' || value === 1 || value === '1') {
      return true
    }
    if (value === false || value === 'false' || value === 0 || value === '0') {
      return false
    }

    const msg = `Validation failed (boolean string is expected for '${metadata?.data || 'value'}')`
    if (this.options?.exceptionFactory) {
      throw this.options.exceptionFactory(msg)
    }
    const status = this.options?.errorHttpStatusCode || 400
    throw new BadRequestException(msg, { statusCode: status })
  }
}

export interface ParseUUIDPipeOptions {
  version?: '3' | '4' | '5' | 'all'
  errorHttpStatusCode?: number
  exceptionFactory?: (error: string) => any
}

const UUID_PATTERNS: Record<string, RegExp> = {
  '3': /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  '4': /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  '5': /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  all: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
}

export class ParseUUIDPipe implements PipeTransform<string, string> {
  constructor(private options?: ParseUUIDPipeOptions) {}

  transform(value: string, metadata?: ArgumentMetadata): string {
    const version = this.options?.version || 'all'
    const pattern = UUID_PATTERNS[version] || UUID_PATTERNS.all

    if (typeof value === 'string' && pattern.test(value)) {
      return value
    }

    const msg = `Validation failed (UUID${version !== 'all' ? ` v${version}` : ''} is expected for '${metadata?.data || 'value'}')`
    if (this.options?.exceptionFactory) {
      throw this.options.exceptionFactory(msg)
    }
    const status = this.options?.errorHttpStatusCode || 400
    throw new BadRequestException(msg, { statusCode: status })
  }
}

export interface ParseArrayPipeOptions {
  items?: any
  separator?: string
  optional?: boolean
  errorHttpStatusCode?: number
  exceptionFactory?: (error: string) => any
}

export class ParseArrayPipe implements PipeTransform<any, any[]> {
  constructor(private options?: ParseArrayPipeOptions) {}

  async transform(value: any, metadata?: ArgumentMetadata): Promise<any[]> {
    if (value === undefined || value === null) {
      if (this.options?.optional) return []
      throw this.createException(metadata?.data || 'value', 'Array is required')
    }

    let arr: any[]
    if (Array.isArray(value)) {
      arr = value
    } else if (typeof value === 'string') {
      const sep = this.options?.separator || ','
      arr = value.split(sep).map((s) => s.trim())
    } else {
      arr = [value]
    }

    if (this.options?.items) {
      const ItemPipe = this.options.items
      const pipeInstance: PipeTransform | undefined =
        typeof ItemPipe === 'function' && ItemPipe.prototype?.transform
          ? new ItemPipe()
          : typeof ItemPipe?.transform === 'function'
            ? ItemPipe
            : undefined

      if (pipeInstance) {
        const transformed: any[] = []
        for (let i = 0; i < arr.length; i++) {
          transformed.push(
            await pipeInstance.transform(arr[i], {
              type: metadata?.type || 'custom',
              data: `${metadata?.data || 'array'}[${i}]`,
            })
          )
        }
        return transformed
      }
    }

    return arr
  }

  private createException(paramName: string, reason = 'Array is expected') {
    const msg = `Validation failed (${reason} for '${paramName}')`
    if (this.options?.exceptionFactory) {
      return this.options.exceptionFactory(msg)
    }
    const status = this.options?.errorHttpStatusCode || 400
    return new BadRequestException(msg, { statusCode: status })
  }
}

export interface ValidationPipeOptions {
  transform?: boolean
  whitelist?: boolean
  forbidNonWhitelisted?: boolean
  disableErrorMessages?: boolean
  errorHttpStatusCode?: number
  exceptionFactory?: (errors: any) => any
}

export class ValidationPipe implements PipeTransform<any, any> {
  constructor(private options?: ValidationPipeOptions) {}

  async transform(value: any, metadata?: ArgumentMetadata): Promise<any> {
    if (value === undefined || value === null) return value

    const metatype = metadata?.metatype
    if (
      !metatype ||
      metatype === Object ||
      metatype === String ||
      metatype === Number ||
      metatype === Boolean ||
      metatype === Array
    ) {
      return value
    }

    if (typeof (metatype as any).parse === 'function') {
      return (metatype as any).parse(value)
    }

    if (
      (metatype as any)['~standard'] &&
      typeof (metatype as any)['~standard'].validate === 'function'
    ) {
      const result = await (metatype as any)['~standard'].validate(value)
      if (result.issues && result.issues.length > 0) {
        const status = this.options?.errorHttpStatusCode || 400
        throw new BadRequestException('Validation Failed', {
          statusCode: status,
          validationErrors: result.issues,
        })
      }
      return result.value
    }

    if (typeof metatype === 'function') {
      let instance = value
      const hasCustomValidate =
        typeof (metatype.prototype as any)?.validate === 'function' ||
        typeof (metatype.prototype as any)?.validateSync === 'function'

      if (this.options?.transform || hasCustomValidate) {
        instance = new metatype()
        Object.assign(instance, value)
      }

      if (typeof instance.validate === 'function') {
        const errors = await instance.validate()
        if (
          errors &&
          (Array.isArray(errors) ? errors.length > 0 : Boolean(errors))
        ) {
          if (this.options?.exceptionFactory) {
            throw this.options.exceptionFactory(errors)
          }
          const status = this.options?.errorHttpStatusCode || 400
          throw new BadRequestException('Validation Failed', {
            statusCode: status,
            validationErrors: errors,
          })
        }
      } else if (typeof instance.validateSync === 'function') {
        const errors = instance.validateSync()
        if (
          errors &&
          (Array.isArray(errors) ? errors.length > 0 : Boolean(errors))
        ) {
          if (this.options?.exceptionFactory) {
            throw this.options.exceptionFactory(errors)
          }
          const status = this.options?.errorHttpStatusCode || 400
          throw new BadRequestException('Validation Failed', {
            statusCode: status,
            validationErrors: errors,
          })
        }
      }

      return instance
    }

    return value
  }
}

/**
 * Binds pipes to a method or controller class.
 *
 * @param pipes Pipe instances or classes to apply to controller arguments
 *
 * @example
 * ```ts
 * @UsePipes(new ValidationPipe({ transform: true }))
 * @Controller('/users')
 * export class UserController {
 *   @Post('/')
 *   @UsePipes(ParseIntPipe)
 *   createUser(@Body() dto: CreateUserDto) {}
 * }
 * ```
 */
export function UsePipes(...pipes: any[]): any {
  return function (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<any>
  ) {
    if (propertyKey && descriptor) {
      const fn = descriptor.value || target[propertyKey]
      const existing = MetadataEngine.get(fn, PIPES_METADATA) || []
      MetadataEngine.set(fn, PIPES_METADATA, [...existing, ...pipes])
      if (fn) {
        ;(fn as any)[PIPES_METADATA] = [...existing, ...pipes]
      }
    } else {
      const proto = typeof target === 'function' ? target.prototype : target
      const existing = MetadataEngine.get(proto, PIPES_METADATA) || []
      MetadataEngine.set(proto, PIPES_METADATA, [...existing, ...pipes])
      if (proto) {
        ;(proto as any)[PIPES_METADATA] = [...existing, ...pipes]
      }
    }
  }
}

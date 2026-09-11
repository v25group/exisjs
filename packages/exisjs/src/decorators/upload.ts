import { METHOD_MIDDLEWARES, PARAM_METADATA_PROP } from './constants'
import { MetadataEngine } from './core/metadata'
import { fileUpload, type FileUploadOptions } from '../middleware/upload'

/**
 * Method or parameter decorator for file uploads.
 *
 * When used on a controller method:
 * Automatically applies the multipart file upload middleware for that route before execution.
 * ```ts
 * @Post('/avatar')
 * @Upload('avatar')
 * uploadAvatar(@UploadedFile() file: ExisFile) {
 *   return { filename: file.filename }
 * }
 * ```
 *
 * When used on a method parameter:
 * Injects the uploaded file (alias for `@UploadedFile`).
 * ```ts
 * @Post('/avatar')
 * @UseUpload({ field: 'avatar' })
 * uploadAvatar(@Upload('avatar') file: ExisFile) {
 *   return { filename: file.filename }
 * }
 * ```
 */
export function Upload(fieldNameOrOptions?: string | FileUploadOptions): any {
  const options: FileUploadOptions =
    typeof fieldNameOrOptions === 'string'
      ? { field: fieldNameOrOptions }
      : fieldNameOrOptions || {}

  const uploadMiddleware = options.field
    ? fileUpload.single(options.field, options)
    : options.fields
      ? fileUpload.fields(options.fields, options)
      : fileUpload(options)

  return function (
    target: any,
    propertyKey?: string | symbol | any,
    descriptorOrIndex?: any
  ) {
    const isParam =
      typeof descriptorOrIndex === 'number' ||
      (propertyKey &&
        typeof propertyKey === 'object' &&
        propertyKey.kind === 'parameter')

    if (isParam) {
      // Parameter decorator
      const parameterIndex =
        typeof descriptorOrIndex === 'number'
          ? descriptorOrIndex
          : propertyKey.index

      const fn = target[propertyKey] || target
      const paramMeta = MetadataEngine.init<any[]>(fn, PARAM_METADATA_PROP, [])
      paramMeta[parameterIndex] = {
        type: 'uploadedFile',
        name: options.field,
        pipes: [],
      }
      return
    }

    // Method decorator
    const fn = descriptorOrIndex?.value || target[propertyKey] || target
    const methodMiddlewares = MetadataEngine.init<any[]>(
      fn,
      METHOD_MIDDLEWARES,
      []
    )
    methodMiddlewares.push(uploadMiddleware)
  }
}

/**
 * Explicit method decorator for file upload middleware.
 *
 * Example:
 * ```ts
 * @Post('/gallery')
 * @UseUpload({ field: 'photos', maxCount: 10, dest: './uploads' })
 * uploadGallery(@UploadedFiles() photos: ExisFile[]) {}
 * ```
 */
export function UseUpload(options?: FileUploadOptions): any {
  return Upload(options)
}

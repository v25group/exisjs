import type { Route, RouteSchema } from '../router/types'
import type {
  OpenApiSpec,
  SwaggerConfig,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
} from './types'

/**
 * Normalizes framework path syntax (`/users/:id`, `/posts/[id]`, `/files/*`) into OpenAPI standard `{id}` path parameters.
 */
export function normalizeOpenApiPath(path: string): string {
  let normalized = path
    // Convert :param to {param}
    .replace(/:([a-zA-Z0-9_]+)/g, '{$1}')
    // Convert [param] and [...param] to {param}
    .replace(/\[\.\.\.([a-zA-Z0-9_]+)\]/g, '{$1}')
    .replace(/\[([a-zA-Z0-9_]+)\]/g, '{$1}')
    // Convert wildcard * to {wildcard}
    .replace(/\/\*$/g, '/{wildcard}')

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }
  return normalized
}

/**
 * Converts a validator or schema object (TexEngine, TexType, Zod, or raw object) to an OpenAPI/JSON Schema.
 */
export function schemaToOpenApi(validator: any): Record<string, any> {
  if (!validator) return { type: 'object' }

  // 1. Tex Native Engine or Type with toOpenApi method
  if (typeof validator.toOpenApi === 'function') {
    return validator.toOpenApi()
  }

  // 1b. Built-in Transformation Pipes
  const pipeName =
    typeof validator === 'function'
      ? validator.name
      : validator?.constructor?.name
  if (pipeName === 'ParseIntPipe') {
    return { type: 'integer' }
  }
  if (pipeName === 'ParseFloatPipe') {
    return { type: 'number', format: 'float' }
  }
  if (pipeName === 'ParseBoolPipe') {
    return { type: 'boolean' }
  }
  if (pipeName === 'ParseUUIDPipe') {
    return { type: 'string', format: 'uuid' }
  }
  if (pipeName === 'ParseArrayPipe') {
    return { type: 'array', items: { type: 'string' } }
  }

  // 2. Direct TexType

  if (
    validator.constructor &&
    validator.constructor.name === 'TexType' &&
    validator._raw
  ) {
    const raw: string = validator._raw.split('|')[0].trim()
    const isOptional = raw.endsWith('?')
    const base = raw.replace('?', '')

    let typeObj: Record<string, any> = { type: 'string' }
    if (base.startsWith('number')) typeObj = { type: 'number' }
    else if (base.startsWith('boolean')) typeObj = { type: 'boolean' }
    else if (base.startsWith('date'))
      typeObj = { type: 'string', format: 'date-time' }
    else if (base.startsWith('email'))
      typeObj = { type: 'string', format: 'email' }
    else if (base.startsWith('uuid'))
      typeObj = { type: 'string', format: 'uuid' }
    else if (base.startsWith('array<'))
      typeObj = { type: 'array', items: { type: 'string' } }

    if (validator.description) typeObj.description = validator.description
    const ex =
      validator.exampleValue !== undefined
        ? validator.exampleValue
        : typeof validator.example !== 'function'
          ? validator.example
          : undefined
    if (ex !== undefined) typeObj.example = ex

    return isOptional ? { ...typeObj, nullable: true } : typeObj
  }

  // 3. Zod-like Duck Typing
  if (typeof validator._def === 'object') {
    const def = validator._def
    const typeName = def.typeName || ''
    const description = validator.description || def.description

    if (typeName === 'ZodString') {
      const result: Record<string, any> = { type: 'string' }
      const min =
        def.minLength?.value ??
        def.checks?.find((c: any) => c.kind === 'min')?.value
      const max =
        def.maxLength?.value ??
        def.checks?.find((c: any) => c.kind === 'max')?.value
      if (min !== undefined) result.minLength = min
      if (max !== undefined) result.maxLength = max
      if (def.checks?.some((c: any) => c.kind === 'email'))
        result.format = 'email'
      if (def.checks?.some((c: any) => c.kind === 'uuid'))
        result.format = 'uuid'
      if (description) result.description = description
      return result
    }
    if (typeName === 'ZodNumber') {
      const result: Record<string, any> = { type: 'number' }
      const min =
        def.minimum ?? def.checks?.find((c: any) => c.kind === 'min')?.value
      const max =
        def.maximum ?? def.checks?.find((c: any) => c.kind === 'max')?.value
      if (min !== undefined) result.minimum = min
      if (max !== undefined) result.maximum = max
      if (description) result.description = description
      return result
    }
    if (typeName === 'ZodBoolean') {
      const result: Record<string, any> = { type: 'boolean' }
      if (description) result.description = description
      return result
    }
    if (typeName === 'ZodDate') {
      const result: Record<string, any> = {
        type: 'string',
        format: 'date-time',
      }
      if (description) result.description = description
      return result
    }
    if (typeName === 'ZodEnum' && Array.isArray(def.values)) {
      const result: Record<string, any> = { type: 'string', enum: def.values }
      if (description) result.description = description
      return result
    }
    if (typeName === 'ZodLiteral') {
      const val = def.value
      const result: Record<string, any> = {
        type:
          typeof val === 'number'
            ? 'number'
            : typeof val === 'boolean'
              ? 'boolean'
              : 'string',
        enum: [val],
      }
      if (description) result.description = description
      return result
    }
    if (typeName === 'ZodArray') {
      const result: Record<string, any> = {
        type: 'array',
        items: schemaToOpenApi(def.type),
      }
      if (description) result.description = description
      return result
    }
    if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
      const inner = schemaToOpenApi(def.innerType)
      return { ...inner, nullable: true }
    }
    if (typeName === 'ZodUnion' && Array.isArray(def.options)) {
      return {
        oneOf: def.options.map((opt: any) => schemaToOpenApi(opt)),
      }
    }
    if (typeName === 'ZodDiscriminatedUnion' && Array.isArray(def.options)) {
      return {
        oneOf: def.options.map((opt: any) => schemaToOpenApi(opt)),
        discriminator: {
          propertyName: def.discriminator,
        },
      }
    }
    if (typeName === 'ZodRecord') {
      return {
        type: 'object',
        additionalProperties: schemaToOpenApi(def.valueType),
      }
    }
    if (typeName === 'ZodEffects') {
      return schemaToOpenApi(def.schema)
    }
    if (typeName === 'ZodObject' && typeof def.shape === 'function') {
      const shape = def.shape()
      const properties: Record<string, any> = {}
      const required: string[] = []
      for (const [key, val] of Object.entries(shape)) {
        properties[key] = schemaToOpenApi(val)
        if (
          (val as any)?._def?.typeName !== 'ZodOptional' &&
          (val as any)?._def?.typeName !== 'ZodNullable'
        ) {
          required.push(key)
        }
      }
      const objResult: Record<string, any> = {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      }
      if (description) objResult.description = description
      return objResult
    }
  }

  // 4. If plain object representation / JSON Schema or raw shape map
  if (typeof validator === 'object' && validator !== null) {
    if (
      validator.type &&
      (validator.properties ||
        validator.items ||
        typeof validator.type === 'string')
    ) {
      return validator
    }
    // If raw map of field definitions: { id: tex.number(), name: tex.string() }
    const keys = Object.keys(validator)
    if (keys.length > 0 && typeof validator[keys[0]] === 'object') {
      const properties: Record<string, any> = {}
      const required: string[] = []
      for (const [k, v] of Object.entries(validator)) {
        properties[k] = schemaToOpenApi(v)
        const isOpt =
          (v as any)?._raw?.includes('?') ||
          (v as any)?._raw?.includes('optional') ||
          (v as any)?._isOptional
        if (!isOpt) required.push(k)
      }
      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      }
    }
  }

  return { type: 'object' }
}

/**
 * Extracts query parameters from route schema into OpenAPI parameter objects.
 */
function extractQueryParameters(
  queryValidator?: any,
  paramMetadata?: any[]
): OpenApiParameter[] {
  const queryParams: OpenApiParameter[] = []
  if (queryValidator) {
    const schema = schemaToOpenApi(queryValidator)
    if (schema.type === 'object' && schema.properties) {
      const requiredList: string[] = Array.isArray(schema.required)
        ? schema.required
        : []
      for (const [name, propSchema] of Object.entries(schema.properties)) {
        queryParams.push({
          name,
          in: 'query',
          required: requiredList.includes(name),
          schema: propSchema as Record<string, any>,
        })
      }
    }
  }

  if (paramMetadata) {
    for (const param of paramMetadata) {
      if (param && param.type === 'query' && param.name) {
        if (!queryParams.some((q) => q.name === param.name)) {
          const pipe = param.pipes?.[0]
          const schema = pipe ? schemaToOpenApi(pipe) : { type: 'string' }
          queryParams.push({
            name: param.name,
            in: 'query',
            required: false,
            schema,
          })
        }
      }
    }
  }

  return queryParams
}

/**
 * Extracts path parameters from the URL string and matched schema into OpenAPI parameters.
 */
function extractPathParameters(
  path: string,
  paramsValidator?: any,
  paramMetadata?: any[]
): OpenApiParameter[] {
  const matches =
    path.match(
      /:([a-zA-Z0-9_]+)|\[\.\.\.([a-zA-Z0-9_]+)\]|\[([a-zA-Z0-9_]+)\]|\*/g
    ) || []
  if (matches.length === 0) return []

  const schema = paramsValidator ? schemaToOpenApi(paramsValidator) : null
  const properties = schema?.properties || {}

  return matches.map((m) => {
    let name = m.replace(/[:[\]]/g, '').replace(/^\.\.\./, '')
    if (m === '*') name = 'wildcard'

    const matchingParam = paramMetadata?.find(
      (p: any) => p && p.type === 'param' && (p.name === name || !p.name)
    )
    const matchingPipe = matchingParam?.pipes?.[0]
    const pipeSchema = matchingPipe ? schemaToOpenApi(matchingPipe) : null

    const propSchema =
      properties[name] ||
      pipeSchema ||
      (schema && schema.type && schema.type !== 'object'
        ? schema
        : { type: 'string' })
    return {
      name,
      in: 'path',
      required: true,
      schema: propSchema,
    }
  })
}

/**
 * Extracts header parameters from route schema.
 */
function extractHeaderParameters(headersValidator?: any): OpenApiParameter[] {
  if (!headersValidator) return []
  const schema = schemaToOpenApi(headersValidator)
  if (schema.type !== 'object' || !schema.properties) return []

  const requiredList: string[] = Array.isArray(schema.required)
    ? schema.required
    : []

  return Object.entries(schema.properties).map(([name, propSchema]) => {
    return {
      name,
      in: 'header',
      required: requiredList.includes(name),
      schema: propSchema as Record<string, any>,
    }
  })
}

/**
 * Generates an OpenAPI 3.1.0 specification object from the registered routes and configuration.
 */
export function generateOpenApiSpec(
  routesOrApp:
    | Route[]
    | { routes?: Route[]; getRoutes?: () => Route[]; getRouter?: () => any },
  config: SwaggerConfig = {}
): OpenApiSpec {
  let routes: Route[] = []
  if (Array.isArray(routesOrApp)) {
    routes = routesOrApp
  } else if (routesOrApp && typeof routesOrApp.getRoutes === 'function') {
    routes = routesOrApp.getRoutes()
  } else if (routesOrApp && typeof routesOrApp.getRouter === 'function') {
    routes = routesOrApp.getRouter().getRoutes()
  } else if (routesOrApp && Array.isArray(routesOrApp.routes)) {
    routes = routesOrApp.routes
  }

  const title = config.title || 'ExisJS API Documentation'
  const version = config.version || '1.0.0'
  const description =
    config.description ||
    'Auto-generated API documentation with native schema validation'

  const paths: Record<string, Record<string, OpenApiOperation>> = {}
  const componentsSchemas: Record<string, any> = {}

  for (const route of routes) {
    // Check if route or schema is explicitly excluded
    const schema: RouteSchema | undefined = route.schema
    if (schema?.excludeFromDocs) continue
    if ((route as any).excludeFromDocs) continue

    const methodLower = route.method.toLowerCase()
    if (methodLower === 'options' || methodLower === 'head') continue

    const methods =
      methodLower === 'all'
        ? ['get', 'post', 'put', 'patch', 'delete']
        : [methodLower]

    const openApiPath = normalizeOpenApiPath(route.path)
    if (!paths[openApiPath]) {
      paths[openApiPath] = {}
    }

    // Parameters
    const paramMeta =
      (schema as any)?.paramMetadata || (route as any).paramMetadata
    const pathParams = extractPathParameters(
      route.path,
      schema?.params,
      paramMeta
    )
    const queryParams = extractQueryParameters(schema?.query, paramMeta)
    const headerParams = extractHeaderParameters(schema?.headers)
    const allParameters: OpenApiParameter[] = [
      ...pathParams,
      ...queryParams,
      ...headerParams,
    ]

    // Request Body
    let requestBody: OpenApiRequestBody | undefined
    if (
      schema?.body &&
      (methods.includes('post') ||
        methods.includes('put') ||
        methods.includes('patch'))
    ) {
      const bodySchema = schemaToOpenApi(schema.body)
      requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: bodySchema,
          },
        },
      }
    } else if (schema?.upload) {
      requestBody = {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                file: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
        },
      }
    }

    // Responses
    const responses: Record<string, OpenApiResponse> = {}
    if (schema?.responses) {
      for (const [code, respDef] of Object.entries(schema.responses)) {
        const respSchema = respDef.schema
          ? schemaToOpenApi(respDef.schema)
          : undefined
        responses[String(code)] = {
          description: respDef.description || `HTTP ${code} Response`,
          ...(respSchema
            ? {
                content: {
                  'application/json': {
                    schema: respSchema,
                  },
                },
              }
            : {}),
        }
      }
    }

    if (schema?.response && Object.keys(responses).length === 0) {
      const resSchema = schemaToOpenApi(schema.response)
      responses['200'] = {
        description: 'Successful operation',
        content: {
          'application/json': {
            schema: resSchema,
          },
        },
      }
    }

    if (Object.keys(responses).length === 0) {
      responses['200'] = {
        description: 'Successful operation',
      }
    }

    // Inherited / route tags
    const tags: string[] =
      schema?.tags && Array.isArray(schema.tags)
        ? schema.tags
        : deriveDefaultTag(route.path)

    for (const m of methods) {
      const operation: OpenApiOperation = {
        tags,
        summary: schema?.summary || `${m.toUpperCase()} ${route.path}`,
        description: schema?.description,
        operationId:
          schema?.operationId ||
          `${m}_${route.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        deprecated: schema?.deprecated,
        parameters: allParameters.length > 0 ? allParameters : undefined,
        requestBody,
        responses,
        security: schema?.security || config.security,
        externalDocs: schema?.externalDocs,
      }

      paths[openApiPath][m] = operation
    }
  }

  const spec: OpenApiSpec = {
    openapi: '3.1.0',
    info: {
      title,
      version,
      description,
      termsOfService: config.termsOfService,
      contact: config.contact,
      license: config.license,
    },
    servers: config.servers || [{ url: '/', description: 'Default Server' }],
    tags: config.tags,
    paths,
    components: {
      schemas:
        Object.keys(componentsSchemas).length > 0
          ? componentsSchemas
          : undefined,
      securitySchemes: config.securitySchemes,
    },
    security: config.security,
  }

  if (typeof config.transformSpec === 'function') {
    const transformed = config.transformSpec(spec)
    if (transformed) return transformed
  }

  return spec
}

function deriveDefaultTag(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  if (
    parts.length > 0 &&
    !parts[0].startsWith(':') &&
    !parts[0].startsWith('[')
  ) {
    const formatted = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
    return [formatted]
  }
  return ['General']
}

export interface OpenApiInfo {
  title: string
  version: string
  description?: string
  termsOfService?: string
  contact?: {
    name?: string
    url?: string
    email?: string
  }
  license?: {
    name: string
    url?: string
  }
}

export interface OpenApiServer {
  url: string
  description?: string
  variables?: Record<
    string,
    { default: string; enum?: string[]; description?: string }
  >
}

export interface OpenApiTag {
  name: string
  description?: string
  externalDocs?: {
    description?: string
    url: string
  }
}

export interface SecuritySchemeObject {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect'
  description?: string
  name?: string
  in?: 'query' | 'header' | 'cookie'
  scheme?: string
  bearerFormat?: string
  flows?: Record<string, any>
  openIdConnectUrl?: string
}

export interface SwaggerConfig {
  /**
   * Whether to enable the interactive API documentation and OpenAPI spec endpoint.
   * Default: `false` (can be enabled globally or per environment).
   */
  enabled?: boolean

  /**
   * The base URL path where the interactive documentation UI will be mounted.
   * Default: `'/docs'`
   */
  path?: string

  /**
   * The URL path where the raw OpenAPI 3.1 JSON specification will be served.
   * Default: `'/docs/json'`
   */
  specPath?: string

  /**
   * API Title shown in the documentation UI.
   * Default: `'ExisJS API Documentation'`
   */
  title?: string

  /**
   * API Version string.
   * Default: `'1.0.0'`
   */
  version?: string

  /**
   * Detailed API description or overview markdown.
   */
  description?: string

  /**
   * Terms of Service URL.
   */
  termsOfService?: string

  /**
   * Contact information for the API.
   */
  contact?: OpenApiInfo['contact']

  /**
   * License information for the API.
   */
  license?: OpenApiInfo['license']

  /**
   * List of target servers (environments) for the API.
   */
  servers?: OpenApiServer[]

  /**
   * Global list of tags with descriptions for organizing operations in groups.
   */
  tags?: OpenApiTag[]

  /**
   * Global security requirements applied across all endpoints unless overridden.
   */
  security?: Record<string, string[]>[]

  /**
   * Reusable security schemes (e.g. Bearer JWT, API Keys, OAuth2).
   */
  securitySchemes?: Record<string, SecuritySchemeObject>

  /**
   * The interactive documentation UI engine to render.
   * Options: `'swagger-ui'` | `'scalar'` (Default: `'swagger-ui'`)
   */
  ui?: 'swagger-ui' | 'scalar'

  /**
   * Custom CSS styling injected into the documentation UI.
   */
  customCss?: string

  /**
   * Custom favicon URL for the documentation page.
   */
  customFavicon?: string

  /**
   * Transform or mutate the generated OpenAPI specification before serving.
   */
  transformSpec?: (spec: OpenApiSpec) => OpenApiSpec | void
}

export interface OpenApiParameter {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  description?: string
  required?: boolean
  deprecated?: boolean
  schema: Record<string, any>
  example?: any
}

export interface OpenApiRequestBody {
  description?: string
  required?: boolean
  content: Record<string, { schema: Record<string, any>; example?: any }>
}

export interface OpenApiResponse {
  description: string
  headers?: Record<string, any>
  content?: Record<string, { schema: Record<string, any>; example?: any }>
}

export interface OpenApiOperation {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses: Record<string, OpenApiResponse>
  deprecated?: boolean
  security?: Record<string, string[]>[]
  externalDocs?: { url: string; description?: string }
}

export interface OpenApiSpec {
  openapi: string
  info: OpenApiInfo
  servers?: OpenApiServer[]
  paths: Record<string, Record<string, OpenApiOperation>>
  components?: {
    schemas?: Record<string, any>
    securitySchemes?: Record<string, SecuritySchemeObject>
    parameters?: Record<string, OpenApiParameter>
    responses?: Record<string, OpenApiResponse>
  }
  security?: Record<string, string[]>[]
  tags?: OpenApiTag[]
}

export interface RouteDocMetadata {
  summary?: string
  description?: string
  tags?: string[]
  operationId?: string
  deprecated?: boolean
  security?: Record<string, string[]>[]
  responses?: Record<number | string, { description?: string; schema?: any }>
  externalDocs?: { url: string; description?: string }
  excludeFromDocs?: boolean
}

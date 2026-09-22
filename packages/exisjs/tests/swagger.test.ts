import { describe, it, expect, beforeEach } from '../src/testing'
import { App } from '../src/server/app'
import { tex } from '../src/validator'
import { route, controller } from '../src/router'
import {
  generateOpenApiSpec,
  normalizeOpenApiPath,
  schemaToOpenApi,
  renderDocumentationHtml,
  mountDocumentation,
  swagger,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiExclude,
} from '../src/swagger'
import { Controller, Get, Post, Body, Param, Query } from '../src/decorators'

describe('ExisJS Swagger & OpenAPI 3.1 Documentation Subsystem', () => {
  let app: App

  beforeEach(() => {
    app = new App({ logger: false })
  })

  describe('Path Normalization & Parameter Extraction', () => {
    it('normalizes express/colon and bracket route paths to OpenAPI curly format', () => {
      expect(normalizeOpenApiPath('/users/:id')).toBe('/users/{id}')
      expect(normalizeOpenApiPath('/users/:userId/posts/:postId')).toBe(
        '/users/{userId}/posts/{postId}'
      )
      expect(normalizeOpenApiPath('/posts/[id]')).toBe('/posts/{id}')
      expect(normalizeOpenApiPath('/files/[...slug]')).toBe('/files/{slug}')
      expect(normalizeOpenApiPath('/assets/*')).toBe('/assets/{wildcard}')
    })
  })

  describe('Schema to OpenAPI Conversion', () => {
    it('converts native TexEngine schemas to valid OpenAPI 3.1 JSON Schema', () => {
      const schema = tex.object({
        id: tex.uuid(),
        name: tex.string({ min: 2 }),
        age: tex.number({ min: 18 }),
        email: tex.email(),
        active: tex.boolean({ default: true }),
        tags: tex.array(tex.string()),
      })

      const openApiSchema = schemaToOpenApi(schema)
      expect(openApiSchema.type).toBe('object')
      expect(openApiSchema.properties.id.type).toBe('string')
      expect(openApiSchema.properties.email.format).toBe('email')
      expect(openApiSchema.properties.age.type).toBe('number')
      expect(openApiSchema.properties.active.type).toBe('boolean')
      expect(openApiSchema.properties.tags.type).toBe('array')
      expect(openApiSchema.required).toContain('id')
      expect(openApiSchema.required).toContain('name')
    })
  })

  describe('Functional Route Spec Generation', () => {
    it('generates full OpenAPI 3.1 specification from functional routes', () => {
      const userListRoute = route.get('/', {
        summary: 'List all users',
        description: 'Returns a paginated list of registered users',
        tags: ['Users'],
        query: tex.pagination({ defaultLimit: 20 }),
        responses: {
          200: {
            description: 'Paginated user list',
            schema: tex.object({
              data: tex.array(
                tex.object({ id: tex.uuid(), name: tex.string() })
              ),
              total: tex.number(),
            }),
          },
        },
        async handle({ query }) {
          return { query }
        },
      })

      const createUserRoute = route.post('/', {
        summary: 'Create a new user',
        tags: ['Users'],
        body: tex.object({
          name: tex.string(),
          email: tex.email(),
        }),
        responses: {
          201: { description: 'User successfully created' },
          400: { description: 'Validation failed' },
        },
        async handle({ body }) {
          return body
        },
      })

      const getUserRoute = route.get('/:id', {
        summary: 'Get user by UUID',
        tags: ['Users'],
        params: tex.object({ id: tex.uuid() }),
        async handle({ params }) {
          return params
        },
      })

      app.get('/api/v1/users', userListRoute as any)
      app.post('/api/v1/users', createUserRoute as any)
      app.get('/api/v1/users/:id', getUserRoute as any)

      const spec = generateOpenApiSpec(app, {
        title: 'User Management API',
        version: '1.2.0',
        description: 'Testing functional OpenAPI spec generation',
      })

      expect(spec.openapi).toBe('3.1.0')
      expect(spec.info.title).toBe('User Management API')
      expect(spec.info.version).toBe('1.2.0')
      expect(spec.paths['/api/v1/users']).toBeDefined()
      expect(spec.paths['/api/v1/users'].get.summary).toBe('List all users')
      expect(spec.paths['/api/v1/users'].get.tags).toEqual(['Users'])
      expect(spec.paths['/api/v1/users'].post.requestBody).toBeDefined()
      expect(spec.paths['/api/v1/users/{id}'].get.parameters?.[0].name).toBe(
        'id'
      )
      expect(spec.paths['/api/v1/users/{id}'].get.parameters?.[0].in).toBe(
        'path'
      )
    })
  })

  describe('Class-Based OOP Decorator Spec Generation', () => {
    it('extracts metadata and schemas from decorated class controllers', async () => {
      @ApiTags('Admin')
      @ApiBearerAuth()
      @Controller('/admin/users')
      class AdminUserController {
        @Get('/')
        @ApiOperation({ summary: 'Admin list all users' })
        @ApiResponse({ status: 200, description: 'Admin user list' })
        async list(@Query('page') _page: number) {
          return []
        }

        @Post('/')
        @ApiOperation({ summary: 'Admin create user' })
        async create(@Body() _dto: any) {
          return { created: true }
        }

        @Get('/hidden')
        @ApiExclude()
        async hidden() {
          return { secret: true }
        }
      }

      app.registerControllers([AdminUserController])

      const spec = generateOpenApiSpec(app, {
        title: 'Admin API',
        version: '1.0.0',
      })

      expect(spec.paths['/admin/users']).toBeDefined()
      expect(spec.paths['/admin/users'].get.tags).toEqual(['Admin'])
      expect(spec.paths['/admin/users'].get.security).toEqual([
        { bearerAuth: [] },
      ])
      expect(spec.paths['/admin/users'].get.summary).toBe(
        'Admin list all users'
      )
      expect(spec.paths['/admin/users/hidden']).toBeUndefined() // @ApiExclude works
    })
  })

  describe('UI Renderer and Endpoints', () => {
    it('renders Swagger UI HTML and Scalar HTML correctly', () => {
      const swaggerHtml = renderDocumentationHtml({
        title: 'My Custom API',
        ui: 'swagger-ui',
        specPath: '/docs/json',
      })
      expect(swaggerHtml).toContain('My Custom API')
      expect(swaggerHtml).toContain('swagger-ui-bundle.js')
      expect(swaggerHtml).toContain('/docs/json')

      const scalarHtml = renderDocumentationHtml({
        title: 'My Scalar API',
        ui: 'scalar',
        specPath: '/api/openapi.json',
      })
      expect(scalarHtml).toContain('My Scalar API')
      expect(scalarHtml).toContain('@scalar/api-reference')
      expect(scalarHtml).toContain('/api/openapi.json')
    })

    it('mounts and responds to /docs and /docs/json requests', async () => {
      app.get('/ping', (_req, res) => res.json({ ping: 'pong' }))

      swagger({
        title: 'Ping API',
        path: '/docs',
        specPath: '/docs/json',
      })(app)

      // Test spec JSON endpoint
      const specRes = await app.inject({
        method: 'GET',
        url: '/docs/json',
      })
      expect(specRes.status).toBe(200)
      const specJson =
        typeof specRes.body === 'string'
          ? JSON.parse(specRes.body)
          : specRes.body
      expect(specJson.openapi).toBe('3.1.0')
      expect(specJson.info.title).toBe('Ping API')
      expect(specJson.paths['/ping']).toBeDefined()

      // Test HTML UI endpoint
      const uiRes = await app.inject({
        method: 'GET',
        url: '/docs',
      })
      expect(uiRes.status).toBe(200)
      expect(uiRes.headers['content-type']).toContain('text/html')
      expect(String(uiRes.body)).toContain('Ping API')
    })
  })
})

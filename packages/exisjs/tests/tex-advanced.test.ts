import { describe, it, expect } from '../src/testing'
import { tex } from '../src/validator'
import { schemaToOpenApi } from '../src/swagger'

describe('Tex Schema Builder Advanced Capabilities & OpenAPI 3.1 Integration', () => {
  describe('tex.discriminatedUnion', () => {
    const square = tex.object({
      kind: tex.literal('square'),
      size: tex.number(),
    })

    const rectangle = tex.object({
      kind: tex.literal('rectangle'),
      width: tex.number(),
      height: tex.number(),
    })

    const circle = tex.object({
      kind: tex.literal('circle'),
      radius: tex.number(),
    })

    const shapeSchema = tex.discriminatedUnion('kind', [
      square,
      rectangle,
      circle,
    ])

    it('parses valid matching variant synchronously', () => {
      const parsed = shapeSchema.parse({
        kind: 'rectangle',
        width: 10,
        height: 20,
      })
      expect(parsed).toEqual({
        kind: 'rectangle',
        width: 10,
        height: 20,
      })
    })

    it('parses valid matching variant asynchronously', async () => {
      const parsed = await shapeSchema.parseAsync({
        kind: 'circle',
        radius: 5,
      })
      expect(parsed).toEqual({
        kind: 'circle',
        radius: 5,
      })
    })

    it('throws when discriminator is missing', () => {
      expect(() => {
        shapeSchema.parse({ width: 10, height: 20 })
      }).toThrow()
    })

    it('throws when discriminator value does not match any variant', () => {
      expect(() => {
        shapeSchema.parse({ kind: 'triangle', base: 10, height: 5 })
      }).toThrow()
    })

    it('generates OpenAPI 3.1 discriminator and oneOf mapping', () => {
      const openApi = shapeSchema.toOpenApi()
      expect(openApi.oneOf).toBeDefined()
      expect(openApi.oneOf.length).toBe(3)
      expect(openApi.discriminator).toEqual({ propertyName: 'kind' })
    })
  })

  describe('tex Schema Composition: extend, merge, pick, omit', () => {
    const baseUser = tex.object({
      id: tex.uuid(),
      name: tex.string({ min: 2 }),
      email: tex.email(),
    })

    it('extends schema with additional fields', () => {
      const extended = baseUser.extend({
        role: tex.enum(['admin', 'user']),
        age: tex.number({ optional: true }),
      })

      const res = extended.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'John',
        email: 'john@example.com',
        role: 'admin',
        age: 30,
      })
      expect(res.role).toBe('admin')
      expect(res.age).toBe(30)
    })

    it('merges two TexEngine schemas', () => {
      const timestampSchema = tex.object({
        createdAt: tex.date({ coerce: true }),
        updatedAt: tex.date({ optional: true, coerce: true }),
      })

      const fullUser = baseUser.merge(timestampSchema)
      const now = new Date().toISOString()
      const res = fullUser.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Jane',
        email: 'jane@example.com',
        createdAt: now,
      })
      expect(res.name).toBe('Jane')
      expect(res.createdAt instanceof Date).toBe(true)
    })

    it('picks specific fields from schema', () => {
      const profile = baseUser.pick(['name', 'email'])
      const res = profile.parse({
        name: 'Alice',
        email: 'alice@example.com',
      })
      expect(res).toEqual({
        name: 'Alice',
        email: 'alice@example.com',
      })
    })

    it('omits specific fields from schema', () => {
      const publicUser = baseUser.omit(['email'])
      const res = publicUser.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Bob',
      })
      expect(res.id).toBe('123e4567-e89b-12d3-a456-426614174000')
      expect(res.name).toBe('Bob')
      expect((res as any).email).toBeUndefined()
    })
  })

  describe('tex Transformations & Coercion', () => {
    it('applies field-level transformation with TexType.transform', () => {
      const schema = tex.object({
        tag: tex.string().transform((v) => v.toLowerCase().trim()),
        count: tex.number().transform((v) => v * 2),
      })

      const res = schema.parse({
        tag: '  EXISJS_FRAMEWORK  ',
        count: 21,
      })
      expect(res.tag).toBe('exisjs_framework')
      expect(res.count).toBe(42)
    })

    it('applies schema-level transformation with TexEngine.transform', () => {
      const schema = tex
        .object({
          firstName: tex.string(),
          lastName: tex.string(),
        })
        .transform((user) => ({
          fullName: `${user.firstName} ${user.lastName}`,
        }))

      const res = schema.parse({
        firstName: 'John',
        lastName: 'Doe',
      })
      expect(res).toEqual({ fullName: 'John Doe' })
    })

    it('tex.coerce namespace coerces primitives reliably', () => {
      const coerceSchema = tex.object({
        num: tex.coerce.number(),
        bool: tex.coerce.boolean(),
        date: tex.coerce.date(),
        str: tex.coerce.string(),
      })

      const res = coerceSchema.parse({
        num: '42',
        bool: 'true',
        date: '2026-01-01T00:00:00.000Z',
        str: 12345,
      })

      expect(res.num).toBe(42)
      expect(res.bool).toBe(true)
      expect(res.date instanceof Date).toBe(true)
      expect(res.str).toBe('12345')
    })
  })

  describe('Universal Multi-Validator OpenAPI 3.1 Duck Typing', () => {
    it('translates TexEngine with field metadata (description, example) to OpenAPI', () => {
      const schema = tex.object({
        title: tex.string().describe('The post title').example('Hello World'),
        views: tex.number().describe('View count').example(100),
      })

      const openApi = schemaToOpenApi(schema)
      expect(openApi.type).toBe('object')
      expect(openApi.properties.title.description).toBe('The post title')
      expect(openApi.properties.title.example).toBe('Hello World')
      expect(openApi.properties.views.description).toBe('View count')
      expect(openApi.properties.views.example).toBe(100)
    })

    it('translates Zod-like schema objects seamlessly via duck typing', () => {
      // Mocking a ZodObject shape
      const mockZodSchema = {
        _def: {
          typeName: 'ZodObject',
          shape: () => ({
            username: {
              _def: { typeName: 'ZodString', minLength: { value: 3 } },
              description: 'User handle',
            },
            age: {
              _def: { typeName: 'ZodNumber', minimum: 18 },
            },
            isAdmin: {
              _def: { typeName: 'ZodBoolean' },
            },
            role: {
              _def: {
                typeName: 'ZodEnum',
                values: ['admin', 'editor', 'viewer'],
              },
            },
            tags: {
              _def: {
                typeName: 'ZodArray',
                type: { _def: { typeName: 'ZodString' } },
              },
            },
          }),
        },
      }

      const openApi = schemaToOpenApi(mockZodSchema)
      expect(openApi.type).toBe('object')
      expect(openApi.properties.username.type).toBe('string')
      expect(openApi.properties.username.minLength).toBe(3)
      expect(openApi.properties.username.description).toBe('User handle')
      expect(openApi.properties.age.type).toBe('number')
      expect(openApi.properties.isAdmin.type).toBe('boolean')
      expect(openApi.properties.role.enum).toEqual([
        'admin',
        'editor',
        'viewer',
      ])
      expect(openApi.properties.tags.type).toBe('array')
      expect(openApi.properties.tags.items.type).toBe('string')
    })
  })

  describe('Type Resolution & Schema Inference (Issue 1 & 2)', () => {
    it('correctly resolves schema fields with primitive builders', () => {
      const UserSchema = tex.object({
        name: tex.string(),
        email: tex.email(),
        age: tex.number().optional(),
        isActive: tex.boolean(),
      })

      type InferredUser = typeof UserSchema._type
      const sample: InferredUser = {
        name: 'Alice',
        email: 'alice@example.com',
        isActive: true,
      }
      expect(sample.name).toBe('Alice')
      expect(sample.email).toBe('alice@example.com')
      expect(sample.isActive).toBe(true)
      expect(sample.age).toBeUndefined()
    })
  })
})

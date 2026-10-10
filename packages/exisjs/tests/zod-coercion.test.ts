import { z } from 'zod'
import { z as z3 } from 'zod/v3'
import { App } from '../src/server/app'
import { createTestApp } from '../src/testing/client'
import { describe, expect, it } from '../src/testing'

function appWith(query: any, params?: any) {
  const app = new App({ logger: false })
  app.get('/items/:id', { query, ...(params && { params }) }, (req, res) => {
    const q: any = req.query
    res.json({
      id: req.params.id,
      page: q.page,
      active: q.active,
      from: q.from instanceof Date ? q.from.toISOString() : q.from,
      name: q.name,
    })
  })
  return createTestApp(app)
}

for (const [label, zod] of [
  ['Zod 4', z],
  ['Zod 3', z3],
] as const) {
  describe(`${label} query and param coercion`, () => {
    const query = (zod as typeof z).object({
      page: (zod as typeof z).number().int().min(1).default(1),
      active: (zod as typeof z).boolean().optional(),
      from: (zod as typeof z).date().optional(),
      name: (zod as typeof z).string().optional(),
    })
    const params = (zod as typeof z).object({ id: (zod as typeof z).number() })

    it('converts number, boolean and date strings before validating', async () => {
      const res = await appWith(query, params)
        .get('/items/42?page=3&active=true&from=2026-10-01&name=007')
        .expect(200)
      expect(res.body).toEqual({
        id: 42,
        page: 3,
        active: true,
        from: '2026-10-01T00:00:00.000Z',
        name: '007', // declared as string, so left untouched
      })
    })

    it('applies defaults when the parameter is absent', async () => {
      const res = await appWith(query).get('/items/1').expect(200)
      expect(res.body.page).toBe(1)
    })

    it('still rejects values that are not numbers', async () => {
      await appWith(query).get('/items/1?page=abc').expect(400)
      await appWith(query, params).get('/items/abc').expect(400)
    })
  })
}

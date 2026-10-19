import {
  describe,
  it,
  expect,
  beforeEach,
  createTestContext,
} from 'exisjs/testing'
import server from '../src/http/server'
import { clearTasks } from '../src/http/tasks/service'

describe('Tasks API', () => {
  const api = createTestContext(server)

  beforeEach(() => clearTasks())

  const create = (body: Record<string, unknown>) =>
    api.post('/tasks').send(body)

  it('creates a task with defaults and cleaned fields', async () => {
    const res = await create({
      title: '  Write docs  ',
      tags: ['Docs', 'docs', 'v0-10'],
      link: { url: 'https://exisjs.dev' },
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      title: 'Write docs',
      status: 'todo',
      tags: ['docs', 'v0-10'],
      link: { url: 'https://exisjs.dev' },
    })
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('lists every problem in a bad body', async () => {
    const res = await create({
      title: '',
      tags: ['ok', 'Not Valid!'],
      link: { url: 'http://insecure.example' },
      startDate: '2026-02-01',
      dueDate: '2026-01-01',
      extra: true,
    })
    expect(res.status).toBe(400)
    const fields = res.body.error.details.map((e: { field: string }) => e.field)
    for (const field of ['extra', 'title', 'tags[1]', 'link.url']) {
      expect(fields).toContain(field)
    }
  })

  it('checks the dates across fields', async () => {
    const res = await create({
      title: 'x',
      startDate: '2026-02-01',
      dueDate: '2026-01-01',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.details[0]).toMatchObject({
      field: 'dueDate',
      message: 'dueDate must not be before startDate',
    })
  })

  it('pages and filters with query values converted from text', async () => {
    for (let i = 0; i < 12; i++) {
      await create({
        title: `t${i}`,
        status: i % 2 ? 'done' : 'todo',
        tags: i < 3 ? ['urgent'] : [],
      })
    }
    const page2 = await api.get('/tasks?page=2&limit=5')
    expect(page2.status).toBe(200)
    expect(page2.body.data).toHaveLength(5)
    expect(page2.body.pagination).toEqual({ page: 2, limit: 5, total: 12 })

    const urgentDone = await api.get('/tasks?status=done&tag=URGENT')
    expect(urgentDone.body.pagination.total).toBe(1)

    expect((await api.get('/tasks?limit=500')).status).toBe(400)
  })

  it('updates part of a task and clears the link with null', async () => {
    const { body: task } = await create({
      title: 'a',
      link: { url: 'https://a.io' },
    })
    const res = await api
      .patch(`/tasks/${task.id}`)
      .send({ status: 'doing', link: null })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ title: 'a', status: 'doing', link: null })
  })

  it('answers 404 for an unknown task and 400 for a malformed id', async () => {
    expect(
      (await api.get('/tasks/2f1c6c1e-2b7a-4c55-9d38-6d0d3b8a1e21')).status
    ).toBe(404)
    expect((await api.get('/tasks/not-a-uuid')).status).toBe(400)
  })

  it('deletes a task', async () => {
    const { body: task } = await create({ title: 'gone' })
    expect((await api.delete(`/tasks/${task.id}`)).status).toBe(204)
    expect((await api.get(`/tasks/${task.id}`)).status).toBe(404)
  })

  it('imports a batch, reporting each bad item instead of failing it', async () => {
    const res = await api.post('/tasks/import').send({
      items: [
        { title: 'one' },
        { title: '' },
        { title: 'three', status: 'blocked' },
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body.imported).toBe(1)
    expect(res.body.results.map((r: { ok: boolean }) => r.ok)).toEqual([
      true,
      false,
      false,
    ])
    expect(res.body.results[2].errors[0].code).toBe('INVALID_ENUM_VALUE')
  })

  it('reports requests by route pattern in /metrics', async () => {
    await api.get('/tasks/2f1c6c1e-2b7a-4c55-9d38-6d0d3b8a1e21')
    const res = await api.get('/metrics')
    expect(res.status).toBe(200)
    expect(res.text).toContain('route="/tasks/:id",status="404"')
    expect(res.text).not.toContain('2f1c6c1e')
  })
})

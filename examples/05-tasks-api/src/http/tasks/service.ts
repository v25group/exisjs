import { randomUUID } from 'node:crypto'
import { HttpError } from 'exisjs/error'
import { createTaskSchema, type CreateTask, type UpdateTask } from './schema'

export interface Task extends CreateTask {
  id: string
  createdAt: Date
  updatedAt: Date
}

// In-memory store: one process only (see docs: running more than one instance)
const tasks = new Map<string, Task>()

export function listTasks(q: {
  page: number
  limit: number
  status?: Task['status']
  tag?: string
}) {
  const all = [...tasks.values()].filter(
    (t) =>
      (!q.status || t.status === q.status) && (!q.tag || t.tags.includes(q.tag))
  )
  const start = (q.page - 1) * q.limit
  return {
    data: all.slice(start, start + q.limit),
    pagination: { page: q.page, limit: q.limit, total: all.length },
  }
}

export function getTask(id: string): Task {
  const task = tasks.get(id)
  if (!task) throw HttpError.notFound('Task')
  return task
}

export function createTask(input: CreateTask): Task {
  const now = new Date()
  const task: Task = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  }
  tasks.set(task.id, task)
  return task
}

export function updateTask(id: string, changes: UpdateTask): Task {
  const task = { ...getTask(id), ...changes, updatedAt: new Date() }
  tasks.set(id, task)
  return task
}

export function deleteTask(id: string): void {
  getTask(id)
  tasks.delete(id)
}

/**
 * Imports many tasks: each item is validated on its own, so one bad item
 * is reported instead of failing the whole batch.
 */
export function importTasks(items: unknown[]) {
  return items.map((item, index) => {
    const result = createTaskSchema.safeParse(item)
    return result.success
      ? { index, ok: true as const, id: createTask(result.data).id }
      : { index, ok: false as const, errors: result.errors }
  })
}

export function clearTasks(): void {
  tasks.clear()
}

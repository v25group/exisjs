import { tex, type ResolveSchema } from 'exisjs/validator'

export const STATUSES = ['todo', 'doing', 'done'] as const

export const taskParamsSchema = tex.object({
  id: tex.uuid(),
})

// Query strings are text: number fields convert, and defaults fill the rest
export const listTasksQuery = tex.object({
  page: tex.number({ int: true, min: 1, default: 1 }),
  limit: tex.number({ int: true, min: 1, max: 50, default: 10 }),
  status: tex.enum(STATUSES, { optional: true }),
  tag: tex.string({ optional: true, trim: true, toLowerCase: true }),
})

const fields = {
  title: tex.string({ trim: true, min: 1, max: 120 }),
  status: tex.enum(STATUSES, { default: 'todo' }),
  tags: tex.array(
    tex.string({ trim: true, toLowerCase: true, pattern: /^[a-z0-9-]+$/ }),
    { max: 5, dedupe: true, default: () => [] }
  ),
  // A nested object that may be left out or cleared with null
  link: tex.object(
    {
      url: tex.url({ protocols: ['https'] }),
      label: tex.string({ optional: true }),
    },
    { nullish: true }
  ),
  startDate: tex.date({ optional: true }),
  dueDate: tex.date({ optional: true }),
}

const datesInOrder = (t: { startDate?: Date; dueDate?: Date }) =>
  !t.startDate || !t.dueDate || t.dueDate >= t.startDate

export const createTaskSchema = tex
  .object(fields, { strict: true })
  .refine(datesInOrder, {
    message: 'dueDate must not be before startDate',
    path: 'dueDate',
  })

export const updateTaskSchema = tex
  .object(fields, { strict: true })
  .partial()
  .refine(datesInOrder, {
    message: 'dueDate must not be before startDate',
    path: 'dueDate',
  })

export type CreateTask = ResolveSchema<typeof createTaskSchema>
export type UpdateTask = ResolveSchema<typeof updateTaskSchema>

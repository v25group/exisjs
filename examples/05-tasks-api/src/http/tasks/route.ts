import { controller, route } from 'exisjs/router'
import { tex } from 'exisjs/validator'
import * as tasks from './service'
import {
  createTaskSchema,
  listTasksQuery,
  taskParamsSchema,
  updateTaskSchema,
} from './schema'

export default controller({
  list: route.get('/', {
    query: listTasksQuery,
    handle({ query }) {
      return tasks.listTasks(query)
    },
  }),

  get: route.get('/:id', {
    params: taskParamsSchema,
    handle({ params }) {
      return tasks.getTask(params.id)
    },
  }),

  create: route.post('/', {
    body: createTaskSchema,
    httpCode: 201,
    handle({ body }) {
      return tasks.createTask(body)
    },
  }),

  update: route.patch('/:id', {
    params: taskParamsSchema,
    body: updateTaskSchema,
    handle({ params, body }) {
      return tasks.updateTask(params.id, body)
    },
  }),

  remove: route.delete('/:id', {
    params: taskParamsSchema,
    httpCode: 204,
    handle({ params }) {
      tasks.deleteTask(params.id)
    },
  }),

  import: route.post('/import', {
    body: tex.object({ items: tex.array(tex.any(), { min: 1, max: 100 }) }),
    handle({ body }) {
      const results = tasks.importTasks(body.items)
      return { imported: results.filter((r) => r.ok).length, results }
    },
  }),
})

import { controller, route } from 'exisjs/router'
import { idempotent } from 'exisjs/middleware'
import { noteBody, noteParams, searchQuery } from './notes.schema'
import * as notes from './notes.service'

export default controller({
  list: route.get('/', {
    handle: ({ req }) => notes.list(req.user.id),
  }),

  search: route.get('/search', {
    query: searchQuery,
    handle: ({ req, query }) => notes.search(req.user.id, query.q),
  }),

  create: route.post('/', {
    middleware: [idempotent()],
    body: noteBody,
    httpCode: 201,
    handle: ({ req, body }) => notes.create(req.user.id, body),
  }),

  read: route.get('/:id', {
    params: noteParams,
    handle: ({ req, params }) => notes.read(req.user.id, params.id),
  }),

  remove: route.delete('/:id', {
    params: noteParams,
    httpCode: 204,
    handle: ({ req, params }) => notes.remove(req.user.id, params.id),
  }),
})

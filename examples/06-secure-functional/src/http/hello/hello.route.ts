import { controller, route } from 'exisjs/router'
import { tex } from 'exisjs/validator'

// Returns client text as a plain string, a classic reflected XSS target
export default controller({
  hello: route.get('/', {
    public: true,
    query: tex.object({ name: tex.string({ max: 200 }) }),
    handle: ({ query }) => `Hello ${query.name}`,
  }),

  // Sends client text as server-sent events, an injection target
  stream: route.get('/stream', {
    public: true,
    query: tex.object({
      msg: tex.string({ max: 500 }),
      event: tex.string({ max: 500, optional: true }),
      id: tex.string({ max: 500, optional: true }),
    }),
    handle: ({ query, res }) => {
      res.sse((sse) => {
        sse.send({ event: query.event, id: query.id, data: query.msg })
        sse.close()
      })
    },
  }),
})

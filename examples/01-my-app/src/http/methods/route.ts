import { controller, route } from 'exisjs/router'

export default controller({
  put: route.put('/', {
    handle() {
      return { method: 'PUT' }
    }
  }),
  patch: route.patch('/', {
    handle() {
      return { method: 'PATCH' }
    }
  }),
  delete: route.delete('/', {
    handle() {
      return { method: 'DELETE' }
    }
  }),
  options: route.options('/', {
    handle() {
      return { method: 'OPTIONS' }
    }
  }),
  head: route.head('/', {
    handle() {
      return { method: 'HEAD' }
    }
  }),
  trace: route.trace('/', {
    handle() {
      return { method: 'TRACE' }
    }
  }),
  queryRoute: route.query('/', {
    handle() {
      return { method: 'QUERY' }
    }
  }),
  allMethods: route.all('/all', {
    handle({ req }) {
      return { method: req.method }
    }
  }),
  websocketRoute: route.ws('/ws', {
    handle({ socket }) {
      socket.on('message', (msg) => {
        socket.send('echo: ' + msg)
      })
    }
  }),
  sseRoute: route.sse('/sse', {
    handle({ stream }) {
      stream.send({ event: 'ping', data: 'pong' })
      stream.close()
    }
  })
})

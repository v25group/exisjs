import { controller, route } from 'exisjs/router'

export default controller({
  streamData: route.sse('/', {
    async handle({ stream }) {
      stream.send({ message: 'Connected' })

      let count = 0
      const interval = setInterval(() => {
        if (!stream.connected) {
          clearInterval(interval)
          return
        }
        stream.send({ count: ++count }, 'tick')
      }, 1000)

      // Optional: Close stream after 5 seconds to test clean teardown
      setTimeout(() => {
        clearInterval(interval)
        stream.close()
      }, 5000)
    }
  })
})

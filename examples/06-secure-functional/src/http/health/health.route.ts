import { controller, route } from 'exisjs/router'

export default controller({
  health: route.get('/', { public: true, handle: () => ({ status: 'ok' }) }),
})


      const { Router } = require('Z:/work-projects/exisjs/framework/packages/exis/src/router/router')
      const router = new Router()
      router.get('/', (req, res) => res.json({ msg: 'users root' }))
      router.get('/profile', (req, res) => res.json({ msg: 'users profile' }))
      exports.router = router
      

      const { Router } = require('Z:/work-projects/exisjs/framework/packages/exis/src/router/router')
      const router = new Router()
      router.get('/', (req, res) => res.json({ msg: 'admin root' }))
      module.exports = router
      
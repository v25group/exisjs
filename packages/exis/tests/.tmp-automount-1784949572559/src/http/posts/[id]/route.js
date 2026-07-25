
      const { Router } = require('Z:/work-projects/exisjs/framework/packages/exis/src/router/router')
      const router = new Router()
      router.get('/', (req, res) => res.json({ id: req.params.id }))
      module.exports = router
      
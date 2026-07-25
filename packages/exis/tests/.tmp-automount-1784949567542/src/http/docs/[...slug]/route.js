
      const { Router } = require('Z:/work-projects/exisjs/framework/packages/exis/src/router/router')
      const router = new Router()
      router.get('/', (req, res) => res.json({ slug: req.params.slug }))
      module.exports = router
      
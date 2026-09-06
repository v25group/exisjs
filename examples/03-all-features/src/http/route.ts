import { controller, route } from 'exisjs/router'
import fs from 'node:fs/promises'
import path from 'node:path'

export default controller({
  home: route.get('/', {
    async handle({ res }) {
      const htmlPath = path.resolve(process.cwd(), 'public', 'index.html')
      const html = await fs.readFile(htmlPath, 'utf-8')
      res.setHeader('Content-Type', 'text/html')
      res.send(html)
    }
  })
})

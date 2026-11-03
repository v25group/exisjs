import path from 'node:path'
import { controller, route } from 'exisjs/router'
import { tex } from 'exisjs/validator'

const UPLOADS = path.resolve('uploads')

export default controller({
  upload: route.post('/', {
    upload: {
      field: 'file',
      maxSize: '100KB',
      allowedMimeTypes: ['image/png', 'text/plain'],
      destination: 'memory',
    },
    httpCode: 201,
    async handle({ req }) {
      const file = (req as any).file
      if (!file) return { saved: null }
      const saved = await file.saveToDisk(UPLOADS)
      return { saved: path.basename(saved), original: file.filename }
    },
  }),

  download: route.get('/:name', {
    params: tex.object({ name: tex.string({ max: 300 }) }),
    handle: ({ params, res }) =>
      res.download(params.name, 'download.bin', { root: UPLOADS }),
  }),
})

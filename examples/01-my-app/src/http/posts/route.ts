import { controller, route } from 'exisjs/router'
import { v } from 'exisjs/validator'
import { getLoaders } from '../../loaders'
import { NotFoundError, BadRequestError } from 'exisjs/error'

const posts: Array<{ id: number, text: string, userId: number, attachment?: string }> = [
  { id: 1, text: 'First post!', userId: 1 }
]

export default controller({
  list: route.get('/', {
    async handle() {
      const { user } = getLoaders()
      const postsWithAuthors = await Promise.all(posts.map(async post => {
        const author = await user.load(String(post.userId))
        return { ...post, author }
      }))
      return postsWithAuthors
    }
  }),

  create: route.post('/', {
    body: {
      text: v.string().min(1)
    },
    handle({ body }) {
      const newPost = { id: posts.length + 1, text: body.text, userId: 1 }
      posts.push(newPost)
      return newPost
    }
  }),

  getById: route.get('/:id', {
    params: {
      id: v.number().transform(Number)
    },
    handle({ params }) {
      const post = posts.find(p => p.id === params.id)
      if (!post) throw new NotFoundError('Post not found')
      return post
    }
  }),

  upload: route.post('/upload', {
    handle({ req }) {
      const files = req.files
      if (!files || files.length === 0) {
        throw new BadRequestError('No files uploaded')
      }
      
      const file = files[0]
      const newPost = { id: posts.length + 1, text: 'Uploaded an attachment', attachment: file.filename, userId: 1 }
      posts.push(newPost)
      
      return { success: true, post: newPost, size: file.data.length }
    }
  })
})

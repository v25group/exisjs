import { controller, route } from 'exisjs/router'
import Groq from 'groq-sdk'
import fs from 'node:fs'
import path from 'node:path'

export default controller({
  // Serve the frontend UI
  home: route.get('/', {
    handle({ res }) {
      const htmlPath = path.join(process.cwd(), 'public', 'index.html')
      const html = fs.readFileSync(htmlPath, 'utf8')
      res.html(html)
    }
  }),

  chat: route.sse('/api/chat', {
    async handle({ stream: sse, req }) {
      // Create Groq client using the API key from .env
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
      
      const message = req.query.message as string
      if (!message) {
        sse.send({ error: 'Message is required' }, 'error')
        sse.close()
        return
      }

      try {
        const stream = await groq.chat.completions.create({
          messages: [{ role: 'user', content: message }],
          model: 'llama-3.1-8b-instant',
          stream: true,
        })

        for await (const chunk of stream) {
          if (!sse.connected) break;
          const content = chunk.choices[0]?.delta?.content || ''
          if (content) {
            sse.send({ text: content }, 'chunk')
          }
        }
        sse.send({ text: '' }, 'done')
      } catch (error) {
        console.error('Groq Error:', error)
        sse.send({ error: 'Failed to fetch response' }, 'error')
      } finally {
        sse.close()
      }
    }
  })
})

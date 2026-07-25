import { Controller, Get, Sse, Stream, Res, Req } from 'exisjs/decorators'
import type { Response, Request, ExisSSE } from 'exisjs/router'
import Groq from 'groq-sdk'
import fs from 'node:fs'
import path from 'node:path'

@Controller()
export default class AIChatController {
  @Get('/')
  serveUI(@Res() res: Response) {
    const htmlPath = path.join(process.cwd(), 'public', 'index.html')
    const html = fs.readFileSync(htmlPath, 'utf8')
    res.html(html)
  }

  @Sse('/api/chat')
  async handleChat(@Stream() sse: ExisSSE, @Req() req: Request) {
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
        if (!sse.connected) break
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
}

import { describe, expect, it } from '../src/testing'
import { Readable } from 'node:stream'
import { createMockResponse, getResponseBody } from './helpers'
import { Router } from '../src/router/router'
import { exis } from '../src'
import { createTestApp } from '../src/testing/client'

describe('Native HTTP Streaming & Backpressure Handling', () => {
  it('streams Node.js Readable stream with default Content-Type', async () => {
    const res = createMockResponse()
    const chunks = ['Hello', ' ', 'Stream', '!']

    const readable = new Readable({
      read() {
        if (chunks.length > 0) {
          this.push(chunks.shift())
        } else {
          this.push(null)
        }
      },
    })

    res.sendStream(readable)

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(res.getHeader('Content-Type')).toBe('application/octet-stream')
    expect(res._body).toBe('Hello Stream!')
  })

  it('supports res.stream() alias', async () => {
    const res = createMockResponse()
    const readable = Readable.from(['Chunk 1', ' ', 'Chunk 2'])

    res.stream(readable)

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(res._body).toBe('Chunk 1 Chunk 2')
  })

  it('streams Web standard ReadableStream chunk-by-chunk', async () => {
    const res = createMockResponse()

    const webStream = new ReadableStream({
      start(controller) {
        controller.enqueue('token1 ')
        controller.enqueue('token2 ')
        controller.enqueue('token3')
        controller.close()
      },
    })

    res.sendStream(webStream)

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(res._body).toBe('token1 token2 token3')
    expect(res.raw.writableEnded).toBe(true)
  })

  it('streams AsyncIterable generators', async () => {
    const res = createMockResponse()

    async function* generateTokens() {
      yield 'AI '
      yield 'token '
      yield 'stream'
    }

    res.sendStream(generateTokens())

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(res._body).toBe('AI token stream')
    expect(res.raw.writableEnded).toBe(true)
  })

  it('automatically destroys Web ReadableStream if client disconnects prematurely', async () => {
    const res = createMockResponse()
    let cancelled = false

    const webStream = new ReadableStream({
      start() {},
      cancel() {
        cancelled = true
      },
    })

    res.sendStream(webStream)
    expect(cancelled).toBe(false)

    // Simulate client abort
    res.raw.emit('close')

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(cancelled).toBe(true)
  })

  it('automatically pipes returned stream from route handlers via router pipeline', async () => {
    const app = exis({
      async onStart(activeApp) {
        activeApp.get('/stream/node', () => {
          return Readable.from(['auto', '-', 'piped'])
        })

        activeApp.get('/stream/async-gen', () => {
          return (async function* () {
            yield 'generator-'
            yield 'output'
          })()
        })
      },
    })

    const server = createTestApp(app)

    const res1 = await server.get('/stream/node')
    expect(res1.status).toBe(200)
    expect(res1.text).toBe('auto-piped')

    const res2 = await server.get('/stream/async-gen')
    expect(res2.status).toBe(200)
    expect(res2.text).toBe('generator-output')
  })

  it('handles stream errors gracefully without crashing process', async () => {
    const res = createMockResponse()

    const faultyStream = new Readable({
      read() {
        this.emit('error', new Error('Underlying socket closed'))
      },
    })

    expect(() => {
      res.sendStream(faultyStream)
    }).not.toThrow()

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(res.statusCode).toBe(500)
    expect(res._body).toContain('Stream transmission failed')
  })
})

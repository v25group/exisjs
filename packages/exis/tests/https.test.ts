import { App } from '../src/server/app'
import { execSync } from 'child_process'
import { request as httpsRequest } from 'https'
import http2 from 'http2'
import fs from 'fs'
import path from 'path'

describe('HTTPS and HTTP/2 Server', () => {
  let key: Buffer
  let cert: Buffer
  const certPath = path.join(__dirname, 'test-cert.pem')
  const keyPath = path.join(__dirname, 'test-key.pem')

  beforeAll(() => {
    // Generate self-signed cert for testing using OpenSSL
    try {
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes -subj "/CN=localhost"`,
        { stdio: 'ignore' }
      )
      key = fs.readFileSync(keyPath)
      cert = fs.readFileSync(certPath)
    } catch (e) {
      console.warn('OpenSSL not available, skipping test cert generation')
    }
  })

  afterAll(() => {
    if (fs.existsSync(certPath)) fs.unlinkSync(certPath)
    if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath)
  })

  it('creates an HTTP/2 secure server by default when SSL is provided', async () => {
    if (!key) return // Skip if OpenSSL failed

    const app = new App({ ssl: { key, cert } })
    app.get('/', (req, res) => res.send('Secure World'))

    const server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))

    const port = (server.address() as any).port

    // Test HTTP/2 connection
    const client = http2.connect(`https://localhost:${port}`, {
      rejectUnauthorized: false,
    })

    const req = client.request({ ':path': '/' })

    const resPromise = new Promise<string>((resolve) => {
      let data = ''
      req.on('data', (chunk) => (data += chunk))
      req.on('end', () => resolve(data))
    })

    req.end()
    const data = await resPromise
    expect(data).toBe('Secure World')

    client.close()
    await app.close()
  })

  it('falls back to HTTPS (HTTP/1.1) when http2 is disabled', async () => {
    if (!key) return

    const app = new App({ ssl: { key, cert }, http2: false })
    app.get('/', (req, res) => res.send('HTTPS World'))

    const server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))

    const port = (server.address() as any).port

    // Test HTTP/1.1 connection over TLS
    const resPromise = new Promise<string>((resolve) => {
      httpsRequest(
        `https://localhost:${port}/`,
        { rejectUnauthorized: false, agent: false },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => resolve(data))
        }
      ).end()
    })

    const data = await resPromise
    expect(data).toBe('HTTPS World')

    await app.close()
  })

  it('auto-redirects HTTP to HTTPS', async () => {
    if (!key) return

    const app = new App()
    app.get('/', (req, res) => res.send('Secure World'))

    // The redirectHttp: 0 means random port for redirect server
    const server = app.listen({ port: 0, ssl: { key, cert }, redirectHttp: 0 })
    await new Promise((resolve) => server.once('listening', resolve))

    const securePort = (server.address() as any).port
    // We have to find the redirect server port. It is stored on the app instance.
    const redirectServer = (app as any).redirectServer
    if (!redirectServer.listening) {
      await new Promise((resolve) => redirectServer.once('listening', resolve))
    }
    const redirectPort = (redirectServer.address() as any).port

    const http = await import('http')

    const resPromise = new Promise<{ statusCode: number; location: string }>(
      (resolve) => {
        http
          .request(
            `http://localhost:${redirectPort}/some-path`,
            { agent: false },
            (res) => {
              resolve({
                statusCode: res.statusCode || 0,
                location: res.headers.location || '',
              })
            }
          )
          .end()
      }
    )

    const result = await resPromise
    expect(result.statusCode).toBe(301)
    expect(result.location).toBe(`https://localhost:${securePort}/some-path`)

    await app.close()
  })
})

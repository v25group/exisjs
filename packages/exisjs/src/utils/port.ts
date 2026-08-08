import net from 'node:net'

export async function getAvailablePort(
  startPort: number,
  host: string,
  maxRetries = 10
): Promise<number> {
  let port = startPort
  for (let i = 0; i < maxRetries; i++) {
    if (await isPortAvailable(port, host)) {
      return port
    }
    port++
  }
  return startPort
}

function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.on('error', () => {
      resolve(false)
    })
    server.listen(port, host, () => {
      server.close(() => resolve(true))
    })
  })
}

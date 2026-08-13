import type {
  ResponseBodyType,
  FetchRequestConfig,
  TransferProgressEvent,
} from '../types'
import { PROGRESS_THROTTLE_MS } from './constants'

export async function parseBody(
  res: Response,
  responseType: ResponseBodyType | undefined,
  transitional?: FetchRequestConfig['transitional']
): Promise<unknown> {
  switch (responseType) {
    case 'text':
      return res.text()
    case 'blob':
      return res.blob()
    case 'arraybuffer':
      return res.arrayBuffer()
    case 'stream':
      return res.body
    case 'formdata':
      return res.formData().catch(() => null)
    default: {
      const ct = res.headers.get('content-type') ?? ''
      const forceJSON = transitional?.forcedJSONParsing !== false
      if (
        responseType === 'json' ||
        (forceJSON && ct.includes('application/json'))
      ) {
        const text = await res.text()
        if (!text) return null
        try {
          return JSON.parse(text)
        } catch {
          if (
            transitional?.silentJSONParsing === false &&
            responseType === 'json'
          ) {
            throw new SyntaxError('JSON parse error')
          }
          return text // silent fallback
        }
      }
      if (ct.startsWith('text/')) return res.text()
      return res.blob()
    }
  }
}

/** Parse with optional streaming download progress (throttled to ~3 events/sec). */
export async function parseBodyWithProgress(
  res: Response,
  responseType: ResponseBodyType | undefined,
  transitional: FetchRequestConfig['transitional'],
  onDownloadProgress?: (e: TransferProgressEvent) => void
): Promise<unknown> {
  if (!onDownloadProgress || !res.body) {
    return parseBody(res, responseType, transitional)
  }

  const contentLength = Number(res.headers.get('content-length')) || undefined
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  let lastEmit = 0
  const startTime = Date.now()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength

    const now = Date.now()
    if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
      const elapsed = (now - startTime) / 1000
      const rate = elapsed > 0 ? loaded / elapsed : 0
      const estimated =
        contentLength && rate > 0 ? (contentLength - loaded) / rate : undefined
      lastEmit = now
      onDownloadProgress({
        loaded,
        total: contentLength,
        progress: contentLength ? loaded / contentLength : undefined,
        bytes: value.byteLength,
        rate,
        estimated,
        download: true,
      })
    }
  }

  // Fire final 100% event
  onDownloadProgress({
    loaded,
    total: contentLength ?? loaded,
    progress: 1,
    bytes: 0,
    download: true,
  })

  // Reconstruct response from collected bytes
  const combined = new Uint8Array(loaded)
  let offset = 0
  for (const c of chunks) {
    combined.set(c, offset)
    offset += c.length
  }

  const reconstructed = new Response(combined, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })

  return parseBody(reconstructed, responseType, transitional)
}

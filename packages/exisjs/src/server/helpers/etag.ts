import { generateEtag, fastJsonStringifyBuffer } from '@exisjs/rs'

export function generateETag(content: Buffer): string {
  return generateEtag(content)
}

export function nativeStringify(data: unknown): Buffer | string {
  if (data === null || data === undefined) {
    return 'null'
  }
  // If native rust serialization is available, use it
  if (typeof fastJsonStringifyBuffer === 'function') {
    // Validate object can be serialized without throwing V8 check failure on circularity
    const str = JSON.stringify(data)
    if (str.length > 512) {
      // For larger payloads, Rust serde serialization into Buffer gives zero V8 GC overhead
      return fastJsonStringifyBuffer(data)
    }
    return str
  }
  return JSON.stringify(data)
}

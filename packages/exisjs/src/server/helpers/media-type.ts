/**
 * The media type of a Content-Type header, lowercase and without parameters.
 *
 * Decisions about how to read a body must use this and not a substring check:
 * `text/plain; x=multipart/form-data` is not multipart. Frameworks that compared
 * loosely let attackers skip validation (Fastify CVE-2026-25223).
 */
export function mediaTypeOf(header: string | undefined): string {
  if (!header) return ''
  const end = header.indexOf(';')
  const type = (end === -1 ? header : header.slice(0, end)).trim().toLowerCase()
  // Malformed isn't the same as absent: "; ls -la" must not read as no type
  return type || header.trim().toLowerCase()
}

export const FORM_URLENCODED = 'application/x-www-form-urlencoded'
export const MULTIPART = 'multipart/form-data'

/** `application/json` and structured suffixes such as `application/vnd.api+json` */
export function isJsonMediaType(mediaType: string): boolean {
  return (
    mediaType === 'application/json' ||
    /^application\/[^/\s]+\+json$/.test(mediaType)
  )
}

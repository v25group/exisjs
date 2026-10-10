import { randomUUID } from 'node:crypto'
import path from 'node:path'

// The multipart field name and filename are client-controlled. Neither may
// reach the filesystem as-is: "../../x" in a field name used to escape the
// upload directory via path.join. Only a short alnum token of each survives,
// and the random part is a UUID instead of guessable Date.now()/Math.random().
export function safeUploadName(fieldname: string, filename: string): string {
  const field =
    String(fieldname || 'file')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 64) || 'file'
  const rawExt = path.extname(String(filename || '')).toLowerCase()
  const ext = /^\.[a-z0-9]{1,16}$/.test(rawExt) ? rawExt : ''
  return `${field}-${randomUUID()}${ext}`
}

// Joins and verifies the result stays inside destDir
export function safeUploadPath(
  destDir: string,
  fieldname: string,
  filename: string
): string {
  const root = path.resolve(destDir)
  const dest = path.resolve(root, safeUploadName(fieldname, filename))
  if (path.dirname(dest) !== root) {
    throw new Error('Refusing to write upload outside destination directory')
  }
  return dest
}

// Applied when a route configures no limits of its own
export const DEFAULT_UPLOAD_LIMITS = {
  files: 10,
  fields: 100,
  parts: 200,
  fieldSize: 1024 * 1024,
}

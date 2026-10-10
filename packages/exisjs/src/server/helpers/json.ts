// JSON body parsing with prototype-pollution protection.
//
// V8's JSON.parse is ~7x faster than round-tripping through the native
// binding (string -> serde Value -> JS object). JSON.parse never pollutes a
// prototype by itself: "__proto__" becomes an own property. The danger is a
// later merge (Object.assign, spread into defaults, deep merge) copying that
// key, so we drop "__proto__" and "constructor" keys the same way the native
// parser did. The full walk only runs when the raw text could contain either
// key; a \u escape could spell one out, so it also triggers the walk.

const SUSPECT = /__proto__|constructor|\\u/

function strip(value: any): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) strip(item)
    return
  }
  if (Object.prototype.hasOwnProperty.call(value, '__proto__')) {
    delete value.__proto__
  }
  if (Object.prototype.hasOwnProperty.call(value, 'constructor')) {
    delete value.constructor
  }
  for (const k in value) strip(value[k])
}

export function stripPrototype<T>(value: T): T {
  strip(value)
  return value
}

export function secureJsonParse<T = unknown>(text: string): T {
  const value = JSON.parse(text)
  if (value !== null && typeof value === 'object' && SUSPECT.test(text)) {
    strip(value)
  }
  return value
}

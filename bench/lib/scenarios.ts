// Request scenarios shared by the HTTP benchmark, the profiler and the
// correctness check. Every server must return `expect` for each scenario.

export interface Scenario {
  id: string
  title: string
  method: 'GET' | 'POST'
  path: string
  body?: string
  expect: { status: number; body: unknown }
}

const user = { name: 'Ada Lovelace', email: 'ada@example.com', age: 36 }

const echoPayload = {
  id: 42,
  title: 'Benchmark payload',
  tags: ['fast', 'typed', 'secure'],
  author: { name: 'Ada', active: true },
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'json',
    title: 'GET /json (static route, small JSON)',
    method: 'GET',
    path: '/json',
    expect: { status: 200, body: { message: 'Hello, World!' } },
  },
  {
    id: 'params',
    title: 'GET /users/:id?fields= (path param + query)',
    method: 'GET',
    path: '/users/12345?fields=name',
    expect: { status: 200, body: { id: '12345', fields: 'name' } },
  },
  {
    id: 'echo',
    title: 'POST /echo (parse + serialize JSON body)',
    method: 'POST',
    path: '/echo',
    body: JSON.stringify(echoPayload),
    expect: { status: 200, body: echoPayload },
  },
  {
    id: 'validate',
    title: 'POST /users (body validation)',
    method: 'POST',
    path: '/users',
    body: JSON.stringify(user),
    expect: { status: 201, body: user },
  },
]

export function pickScenarios(spec: string | true | undefined): Scenario[] {
  if (typeof spec !== 'string') return SCENARIOS
  const ids = spec.split(',').map((s) => s.trim())
  const unknown = ids.filter((id) => !SCENARIOS.some((s) => s.id === id))
  if (unknown.length) {
    throw new Error(
      `Unknown scenario(s): ${unknown.join(', ')}. Known: ${SCENARIOS.map((s) => s.id).join(', ')}`
    )
  }
  return SCENARIOS.filter((s) => ids.includes(s.id))
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]])
        )
      : v
  )
}

/**
 * Sends one request and checks status and body. A benchmark of a server that
 * answers wrongly (404, validation failure, different payload) is
 * meaningless, so the runner refuses to measure it.
 */
export async function verify(port: number, s: Scenario): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}${s.path}`, {
    method: s.method,
    headers: s.body ? { 'content-type': 'application/json' } : undefined,
    body: s.body,
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // keep raw text for the error message
  }
  if (
    res.status !== s.expect.status ||
    stable(body) !== stable(s.expect.body)
  ) {
    throw new Error(
      `${s.id}: expected ${s.expect.status} ${stable(s.expect.body)}, got ${res.status} ${text.slice(0, 200)}`
    )
  }
}

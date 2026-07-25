import { run, bench, group } from 'mitata'
import { Router } from '../packages/exis/src/router/router'
import FindMyWay from 'find-my-way'
import { TrieRouter } from 'hono/router/trie-router'
import { SmartRouter } from 'hono/router/smart-router'
import { RegExpRouter } from 'hono/router/reg-exp-router'

const exis = new Router()
const fmw = FindMyWay()
const hono = new SmartRouter({
  routers: [new RegExpRouter(), new TrieRouter()],
})

const emptyHandler = () => {
  // noop
}

// Setup 1,000 dummy routes to simulate a large app
for (let i = 0; i < 1000; i++) {
  const staticPath = `/api/v1/dummy-${i}/test`
  exis.get(staticPath, emptyHandler)
  fmw.on('GET', staticPath, emptyHandler)
  hono.add('GET', staticPath, emptyHandler)
}

// Add our target routes
exis.get('/api/users/profile', emptyHandler)
fmw.on('GET', '/api/users/profile', emptyHandler)
hono.add('GET', '/api/users/profile', emptyHandler)

exis.get('/api/users/:id', emptyHandler)
fmw.on('GET', '/api/users/:id', emptyHandler)
hono.add('GET', '/api/users/:id', emptyHandler)

exis.get('/api/docs/*path', emptyHandler)
fmw.on('GET', '/api/docs/*', emptyHandler)
hono.add('GET', '/api/docs/*', emptyHandler)

console.log('Running Benchmarks for 1,000+ routes...\n')

group('Static Route Match (/api/users/profile)', () => {
  bench('Exis (Radix Tree)', () => exis.match('GET', '/api/users/profile'))
  bench('Fastify (find-my-way)', () => fmw.find('GET', '/api/users/profile'))
  bench('Hono (TrieRouter)', () => hono.match('GET', '/api/users/profile'))
})

group('Dynamic Route Match (/api/users/12345)', () => {
  bench('Exis (Radix Tree)', () => exis.match('GET', '/api/users/12345'))
  bench('Fastify (find-my-way)', () => fmw.find('GET', '/api/users/12345'))
  bench('Hono (TrieRouter)', () => hono.match('GET', '/api/users/12345'))
})

group('Wildcard Route Match (/api/docs/exis/intro)', () => {
  bench('Exis (Radix Tree)', () => exis.match('GET', '/api/docs/exis/intro'))
  bench('Fastify (find-my-way)', () => fmw.find('GET', '/api/docs/exis/intro'))
  bench('Hono (TrieRouter)', () => hono.match('GET', '/api/docs/exis/intro'))
})

// Mitata requires async run()
async function start() {
  await run()
}
start()

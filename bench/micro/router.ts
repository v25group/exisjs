/**
 * Route lookup micro-benchmark: ExisJS vs find-my-way (Fastify) vs Hono.
 *
 *   npm run bench:router
 *
 * 1,000 static routes plus the routes under test, so lookups run against a
 * realistically sized table. Results go through do_not_optimize() so V8
 * cannot drop a lookup whose result is unused.
 */
import FindMyWay from 'find-my-way'
import { SmartRouter } from 'hono/router/smart-router'
import { RegExpRouter } from 'hono/router/reg-exp-router'
import { TrieRouter } from 'hono/router/trie-router'
// Router is internal (not a public export); benchmark the compiled build
import { Router } from '../../packages/exisjs/dist/router/router'
import { assertFreshBuild } from '../lib/harness'

assertFreshBuild()

// mitata is ESM-only; load it dynamically from this CommonJS script
async function main() {
  const { run, bench, group, summary, do_not_optimize } = await import('mitata')

  const noop = () => undefined
  const exis = new Router()
  const fmw = FindMyWay()
  const hono = new SmartRouter<() => void>({
    routers: [new RegExpRouter(), new TrieRouter()],
  })

  for (let i = 0; i < 1000; i++) {
    const p = `/api/v1/resource-${i}/items`
    exis.get(p, noop)
    fmw.on('GET', p, noop)
    hono.add('GET', p, noop)
  }
  for (const [exisPath, otherPath] of [
    ['/api/users/profile', '/api/users/profile'],
    ['/api/users/:id', '/api/users/:id'],
    ['/api/orgs/:org/repos/:repo', '/api/orgs/:org/repos/:repo'],
    ['/static/*path', '/static/*'],
  ]) {
    exis.get(exisPath, noop)
    fmw.on('GET', otherPath, noop)
    hono.add('GET', otherPath, noop)
  }

  const cases: [string, string][] = [
    ['static', '/api/users/profile'],
    ['static, among 1,000', '/api/v1/resource-737/items'],
    ['1 param', '/api/users/12345'],
    ['2 params', '/api/orgs/exis/repos/framework'],
    ['wildcard', '/static/css/app/main.css'],
    ['miss (404)', '/api/nothing/here'],
  ]

  for (const [name, url] of cases) {
    group(`${name}: ${url}`, () => {
      summary(() => {
        bench('exisjs', () => do_not_optimize(exis.match('GET', url)))
        bench('find-my-way', () => do_not_optimize(fmw.find('GET', url)))
        bench('hono smart', () => do_not_optimize(hono.match('GET', url)))
      })
    })
  }

  await run()
}

void main()

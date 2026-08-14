import { describe, test as it, expect } from 'exisjs/testing'
import { RadixRouter } from '../index.js'

describe('Rust RadixRouter Integration Tests', () => {
  it('Matches static paths and extracts empty params', () => {
    const router = new RadixRouter()
    router.insert('GET', '/api/users', 1)
    router.insert('POST', '/api/users', 2)

    const matchGet = router.search('GET', '/api/users')
    expect(matchGet).toBeTruthy()
    expect(matchGet?.routeId).toBe(1)
    expect(matchGet?.params).toEqual({})

    const matchPost = router.search('POST', '/api/users')
    expect(matchPost).toBeTruthy()
    expect(matchPost?.routeId).toBe(2)
    expect(matchPost?.params).toEqual({})

    const matchDelete = router.search('DELETE', '/api/users')
    expect(matchDelete).toBeNull()
  })

  it('Matches trailing slash gracefully', () => {
    const router = new RadixRouter()
    router.insert('GET', '/api/users', 10)

    const match = router.search('GET', '/api/users/')
    expect(match).toBeTruthy()
    expect(match?.routeId).toBe(10)
  })

  it('Extracts single and multiple dynamic parameters', () => {
    const router = new RadixRouter()
    router.insert('GET', '/api/users/:id', 101)
    router.insert('GET', '/api/:org/:repo', 102)

    const match1 = router.search('GET', '/api/users/123')
    expect(match1).toBeTruthy()
    expect(match1?.routeId).toBe(101)
    expect(match1?.params).toEqual({ id: '123' })

    const match2 = router.search('GET', '/api/exis/framework')
    expect(match2).toBeTruthy()
    expect(match2?.routeId).toBe(102)
    expect(match2?.params).toEqual({ org: 'exis', repo: 'framework' })
  })

  it('Decodes URI-encoded parameters', () => {
    const router = new RadixRouter()
    router.insert('GET', '/api/users/:name', 201)

    const match = router.search('GET', '/api/users/John%20Doe')
    expect(match).toBeTruthy()
    expect(match?.routeId).toBe(201)
    expect(match?.params).toEqual({ name: 'John Doe' })
  })

  it('Matches wildcard routes (anonymous and named)', () => {
    const router = new RadixRouter()
    router.insert('GET', '/api/*', 301)
    router.insert('GET', '/docs/*slug', 302)

    const match1 = router.search('GET', '/api/anything/here/deeply')
    expect(match1).toBeTruthy()
    expect(match1?.routeId).toBe(301)

    const match2 = router.search('GET', '/docs/getting-started/intro')
    expect(match2).toBeTruthy()
    expect(match2?.routeId).toBe(302)
    expect(match2?.params).toEqual({ slug: 'getting-started/intro' })
  })

  it('ALL method matches any HTTP method', () => {
    const router = new RadixRouter()
    router.insert('ALL', '/webhook', 401)

    expect(router.search('GET', '/webhook')?.routeId).toBe(401)
    expect(router.search('POST', '/webhook')?.routeId).toBe(401)
    expect(router.search('DELETE', '/webhook')?.routeId).toBe(401)
  })
})

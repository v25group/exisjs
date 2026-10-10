import {
  test,
  describe,
  expect,
  createTestContext,
  beforeAll,
} from 'exisjs/testing'
import app from '../src/http/server'
import { User } from '../src/models/User'
import { Book } from '../src/models/Book'

// Runs against the database in .env.test (bookstore_test)
describe('Bookstore API', () => {
  const api = createTestContext(app)
  const account = {
    email: 'reader@example.com',
    username: 'reader',
    password: 'correct-horse',
  }
  let auth = ''
  let bookId = ''

  beforeAll(async () => {
    await Promise.all([User.deleteMany({}), Book.deleteMany({})])
  })

  test('registers a user and stores a hashed password', async () => {
    const res = await api.post('/api/auth/register').send(account).execute()
    expect(res.status).toBe(201)
    expect(res.body.user.username).toBe('reader')
    expect(res.body.user.password).toBe(undefined)

    const stored = await User.findOne({ email: account.email }).select(
      '+password'
    )
    expect(stored!.password === account.password).toBe(false)
  })

  test('rejects a duplicate email', async () => {
    const res = await api.post('/api/auth/register').send(account).execute()
    expect(res.status).toBe(409)
  })

  test('logs in with the same password', async () => {
    const wrong = await api
      .post('/api/auth/login')
      .send({ email: account.email, password: 'wrong-password' })
      .execute()
    expect(wrong.status).toBe(401)

    const res = await api
      .post('/api/auth/login')
      .send({ email: account.email, password: account.password })
      .execute()
    expect(res.status).toBe(200)
    auth = `Bearer ${res.body.token}`
  })

  test('requires a token to create a book', async () => {
    const res = await api
      .post('/api/books')
      // Even an invalid payload gets 401: authentication runs before validation
      .send({ title: 'T' })
      .execute()
    expect(res.status).toBe(401)
  })

  test('validates the book payload', async () => {
    const res = await api
      .post('/api/books')
      .set('Authorization', auth)
      .send({ title: 'T', caption: 'C', rating: 9, image: 'cover.png' })
      .execute()
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  test('creates, lists and deletes a book', async () => {
    const created = await api
      .post('/api/books')
      .set('Authorization', auth)
      .send({ title: 'Dune', caption: 'Sand', rating: 5, image: 'dune.png' })
      .execute()
    expect(created.status).toBe(201)
    bookId = created.body._id

    const list = await api.get('/api/books?page=1&limit=5').execute()
    expect(list.status).toBe(200)
    expect(list.body.totalBooks).toBe(1)
    expect(list.body.books[0].user.username).toBe('reader')

    const mine = await api
      .get('/api/books/user')
      .set('Authorization', auth)
      .execute()
    expect(mine.body.length).toBe(1)

    const badId = await api
      .delete('/api/books/not-an-id')
      .set('Authorization', auth)
      .execute()
    expect(badId.status).toBe(404)

    const deleted = await api
      .delete(`/api/books/${bookId}`)
      .set('Authorization', auth)
      .execute()
    expect(deleted.status).toBe(200)
  })
})

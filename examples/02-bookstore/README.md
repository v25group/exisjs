# 02-bookstore: class-based ExisJS example

A bookstore API written with the **class-based (OOP)** style (`@Controller`, `@Get`, `@Post`...) on MongoDB with Mongoose.

## What it shows

| Feature | Where |
| :--- | :--- |
| Decorator controllers | `src/http/**/route.ts` |
| Validated environment variables | `src/config/env.ts` |
| Database lifecycle managed by the framework | `src/config/db.ts` (`registerDatabase`) |
| Typed request bodies from `tex` schemas | `@Body(Schema) body: Infer<typeof Schema>` |
| Register / login with a hashed password | `src/http/api/auth/route.ts`, `src/models/User.ts` |
| Protecting routes with `@Use(protectRoute)` | `src/middleware/auth.ts`, `src/http/api/books/route.ts` |
| Custom status codes with `@HttpCode` | register, create book |
| File upload with `@UploadedFile` | `POST /api/books/cover` |
| Idempotent requests with `@Idempotent` | `POST /api/books/checkout` |
| Health check that reports the database | `src/http/health/route.ts` |
| Tests on a separate database | `tests/`, `.env.test` |

## Getting started

You need MongoDB running locally (or a connection string).

```bash
cp .env.example .env     # set MONGODB_URI and a long random JWT_SECRET
npm install
npm run dev
```

The API listens on [http://localhost:4000](http://localhost:4000). Interactive docs are at [http://localhost:4000/docs](http://localhost:4000/docs).

## Endpoints

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | – | Create an account, returns a token |
| `POST` | `/api/auth/login` | – | Exchange credentials for a token |
| `GET` | `/api/auth/me` | Bearer | The current user |
| `GET` | `/api/books` | – | List books (`?page=&limit=`) |
| `GET` | `/api/books/user` | Bearer | Books created by the current user |
| `POST` | `/api/books` | Bearer | Create a book |
| `POST` | `/api/books/cover` | Bearer | Upload a cover image |
| `POST` | `/api/books/checkout` | Bearer | Idempotent checkout (send `Idempotency-Key`) |
| `DELETE` | `/api/books/:id` | Bearer | Delete a book you own |
| `GET` | `/health` | – | Service and database status |

## Scripts

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Development server with reload |
| `npm test` | Runs `tests/` against the `bookstore_test` database from `.env.test` |
| `npm run build` | Type-checks and compiles to `.exis/` |
| `npm start` | Runs the production build |

## Notes

- Passwords are hashed in one place only: the `pre('save')` hook in `src/models/User.ts`.
- The database is registered once in `src/config/db.ts`. ExisJS connects it at startup and disconnects it on shutdown, so `onStart`/`onClose` do not touch it.

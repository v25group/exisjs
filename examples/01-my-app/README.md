# 01-my-app: functional ExisJS example

A small API written with the **functional** style (`controller()` + `route.*`). It runs without a database: users are kept in memory.

## What it shows

| Feature | Where |
| :--- | :--- |
| File-system routing | `src/http/**/route.ts` |
| Validated environment variables | `src/config/env.ts` |
| Request validation with `tex` | `src/http/auth/route.ts`, `src/http/users/schema.ts` |
| Register / login with hashed passwords and JWT | `src/http/auth/route.ts`, `src/middleware/auth.ts` |
| Protecting a whole folder with a boundary | `src/http/users/boundary.ts` |
| Typed `req.user` from middleware | `src/http/users/route.ts` (`/users/me`) |
| Services resolved through dependency injection | `resolve(UsersService)` |
| App lifecycle hooks | `src/http/server.ts` |
| A plugin with its own routes | `src/plugins/metrics.ts` |
| Cron jobs | `src/http/cron.ts` |
| Swagger UI | `/docs` (configured in `exis.config.ts`) |
| Tests that boot the app in-process | `tests/` |

## Getting started

```bash
cp .env.example .env     # then set JWT_SECRET to a long random value
npm install
npm run dev
```

The API listens on [http://localhost:4000](http://localhost:4000). Interactive docs are at [http://localhost:4000/docs](http://localhost:4000/docs).

## Try it

```bash
# Create an account (returns a token)
curl -X POST http://localhost:4000/auth/register \
  -H "content-type: application/json" \
  -d '{"name":"Ada","email":"ada@example.com","password":"correct-horse"}'

# /users is protected by src/http/users/boundary.ts
curl http://localhost:4000/users                              # 401
curl http://localhost:4000/users -H "authorization: Bearer <token>"
```

## Scripts

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Development server with reload |
| `npm test` | Runs `tests/` against the app in-process |
| `npm run build` | Type-checks and compiles to `.exis/` |
| `npm start` | Runs the production build |

## Learn more

- [ExisJS documentation](https://github.com/v25group/exisjs/tree/main/docs)
- [Routing guide](https://github.com/v25group/exisjs/blob/main/docs/content/routing.mdx)
- [Validation guide](https://github.com/v25group/exisjs/blob/main/docs/content/validation.mdx)

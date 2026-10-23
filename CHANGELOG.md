# Changelog

All notable changes to the ExisJS framework monorepo are documented here and in modular release files under [`changelog/`](./changelog/).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Release Directory & Navigation

| Version | Release Date | Type | Key Highlights | Detailed Notes |
| :--- | :--- | :--- | :--- | :--- |
| **`v0.10.1`** | 2026-10-23 | Patch: Bug Fixes & Security | Compressed responses no longer sent as `204` with no body; `hpp()` keeps JSON arrays; one copy of each module in tests; `exisjs test` fails a file that doesn't exit; access checked before validation; `trustProxy: 'cloudflare'`; CSRF behind proxies; one rule for databases that can't connect (`required`); exact `ExisUser` types; `start` runs `node .exis/server/main.js` | [**Read v0.10.1 Notes →**](./changelog/v0.10/v0.10.1.md) |
| **`v0.10.0`** | 2026-10-21 | Minor, breaking | CLI moved to `@exisjs/cli`, one-process `exisjs start` without the CLI, production install 45 MB → 4.5 MB; `/metrics`; `queue` limits; readiness drain on shutdown; settings that did nothing fail at start-up; `migrate` checks Dockerfile, `nixpacks.toml` and `Procfile`; health probes log at `debug` | [**Read v0.10.0 Notes →**](./changelog/v0.10/v0.10.0.md) |
| **`v0.10.0-beta.0`** | 2026-10-20 | Prerelease (`beta` tag) | Ctrl+C in a terminal skips the readiness drain; deployment guide: use a clean `npm ci --omit=...` instead of `npm prune` | [**Read v0.10.0 Notes →**](./changelog/v0.10/v0.10.0.md) |
| **`v0.10.0-alpha.2`** | 2026-10-20 | Prerelease (`alpha` tag) | Fixes from testing alpha.1: `server` in `exis.config.ts` takes effect and the uWS fallback warning prints, "install the CLI" hints name the matching version, start errors no longer show framework code on Windows | [**Read v0.10.0 Notes →**](./changelog/v0.10/v0.10.0.md) |
| **`v0.10.0-alpha.1`** | 2026-10-20 | Prerelease (`alpha` tag) | Fixes from testing alpha.0: `/_ready` answers `503` during a shutdown drain, the `migrate` notice appears, a global CLI hands off to the project's, production logs from `exisjs start`, failing route files are named | [**Read v0.10.0 Notes →**](./changelog/v0.10/v0.10.0.md) |
| **`v0.10.0-alpha.0`** | 2026-10-19 | Prerelease (`alpha` tag): Minor, breaking | CLI moved to `@exisjs/cli`, one-process `exisjs start` without the CLI, production install 45 MB → 4.5 MB; `/metrics`; `queue` limits; failed route files stop the start; `partial()` keeps unsent fields unset | [**Read v0.10.0 Notes →**](./changelog/v0.10/v0.10.0.md) |
| **`v0.9.2`** | 2026-10-17 | Patch: Bug Fixes & Security | Development server: no `404` for concurrent first requests, a route that fails to load answers `500`, route files run once, `dev.lazyRoutes`; `env` defaults to `production` so a server started without `NODE_ENV` no longer sends error details; validator: nested rules, immutable schemas, `safeParse`, `pattern` / `url` / `int`, 4-10x faster; sanitizer fixes | [**Read v0.9.2 Notes →**](./changelog/v0.9/v0.9.2.md) |
| **`v0.9.1`** | 2026-10-16 | Patch: Bug Fixes | RFC 9110 conditional requests (`res.checkPreconditions()`, 304/412/428), binary request bodies kept intact, boundary wrappers keep a returned `Buffer` binary, nested `tex.object` `.optional()` honoured, `.nullable()` / `.nullish()` on object schemas, clear error for a missing field schema, AGENTS.md docs path | [**Read v0.9.1 Notes →**](./changelog/v0.9/v0.9.1.md) |
| **`v0.9.0`** | 2026-10-14 | Minor (breaking): Correctness & Security | Request-scoped DI and `@Idempotent` cross-user leaks fixed, hung requests answered, class controllers handle `res.json()`/`download()`/Buffers and `@UseInterceptors`, safe RBAC (401, all-of permissions, no `isSuperAdmin`), one error envelope, default CSP, readiness endpoint, shared rate-limit and cron-lock stores | [**Read v0.9.0 Notes →**](./changelog/v0.9/v0.9.0.md) |
| **`v0.8.1`** | 2026-10-12 | Patch: Security & Build | `ipFilter` X-Forwarded-For bypass fixed, `serveStatic` sibling-directory traversal fixed, `exisjs build` works on hosts without `devDependencies` | [**Read v0.8.1 Notes →**](./changelog/v0.8/v0.8.1.md) |
| **`v0.8.0`** | 2026-10-09 | Major: Pure TS Core, Perf & Security | `@exisjs/rs` removed (pure TypeScript core), ~50% less framework overhead per request, compiled `tex` validator, upload/IP-spoofing/cross-request security fixes, Node.js 20+ | [**Read v0.8.0 Notes →**](./changelog/v0.8/v0.8.0.md) |
| **`v0.7.14`** | 2026-10-05 | Stability & Hardening | Windows path quoting fix for `exis run`, FS route specificity sorting, binary/stream `res.download()`, Windows libuv shutdown `UV_HANDLE_CLOSING` & `EPIPE` resolution, type inference strictness | [**Read v0.7.14 Notes →**](./changelog/v0.7/v0.7.14.md) |
| **`v0.7.13`** | 2026-10-02 | Feature & Engine Upgrades | `tex.discriminatedUnion`, schema composition (`extend`, `merge`, `pick`, `omit`), field/schema `transform`, `tex.coerce` primitives, multi-validator OpenAPI 3.1 translation | [**Read v0.7.13 Notes →**](./changelog/v0.7/v0.7.13.md) |
| **`v0.7.12`** | 2026-10-02 | Alignment & Patch | Automatic boot database connection (`DatabaseManager.connectAll()`), health check dual callback (`isHealthy` & `healthCheck`), docs sync, template update | [**Read v0.7.12 Notes →**](./changelog/v0.7/v0.7.12.md) |
| **`v0.7.11`** | 2026-10-01 | Performance & DX | Static route fast path (>51k req/s), lazy AbortSignal, uWS adapter event parity, `timingSafeEqual`, configurable `dev` watcher, flexible `registerDatabase`, `create-exisjs` cron scaffolding | [**Read v0.7.11 Notes →**](./changelog/v0.7/v0.7.11.md) |
| **`v0.7.10`** | 2026-09-27 | Feature & Resilience | Controller inheritance, property `@Inject`/`@Optional`, `forwardRef` circular DI, parameter transformation pipes, `@Global()` modules, DI parameter reflection, Mongoose/BSON safe serializer, query type coercion, error envelope standardization, CDN IP resolution | [**Read v0.7.10 Notes →**](./changelog/v0.7/v0.7.10.md) |
| **`v0.7.9`** | 2026-09-24 | Feature & Architecture | Enterprise OOP upgrades (Security, Caching, Transactions, Profiling, Lifecycles, Filters), ESM alias fix | [**Read v0.7.9 Notes →**](./changelog/v0.7/v0.7.9.md) |
| **`v0.7.8`** | 2026-09-22 | Patch & Export Fixes | Subpath export `exisjs/swagger`, root exports, canonical doc fixes | [**Read v0.7.8 Notes →**](./changelog/v0.7/v0.7.8.md) |
| **`v0.7.7`** | 2026-09-22 | Features & Architecture | Native Swagger/OpenAPI 3.1, subsystem modularization, comprehensive TSDoc | [**Read v0.7.7 Notes →**](./changelog/v0.7/v0.7.7.md) |
| **`v0.7.6`** | 2026-09-21 | Stability, DX & Perf | Response toolkit, actionable error envelopes, single-line logger, `tex.env` | [**Read v0.7.6 Notes →**](./changelog/v0.7/v0.7.6.md) |
| **`v0.7.5`** | 2026-09-19 | Resilience & DX | Error convention, boundary hooks, AbortSignal, CHIPS, instant shutdown | [**Read v0.7.5 Notes →**](./changelog/v0.7/v0.7.5.md) |
| **`v0.7.4`** | 2026-09-11 | Features & Validations | Diagnostic table, declarative uploads, route timeouts, nested arrays | [**Read v0.7.4 Notes →**](./changelog/v0.7/v0.7.4.md) |
| **`v0.7.3`** | 2026-09-09 | Features & Rust Perf | Native Rust Brotli/Gzip, realtime SSE streaming, `exis routes` & `doctor` CLI | [**Read v0.7.3 Notes →**](./changelog/v0.7/v0.7.3.md) |
| **`v0.7.2`** | 2026-09-06 | Bug Fixes & DX | TypeScript route param inference, runtime aliases, ESM relative fixes | [**Read v0.7.2 Notes →**](./changelog/v0.7/v0.7.2.md) |
| **`v0.7.1`** | 2026-09-06 | OOP & Logging | Full OOP parity decorators, DI scopes, `@Use(...)` unification, Pino logger | [**Read v0.7.1 Notes →**](./changelog/v0.7/v0.7.1.md) |
| **`v0.7.0`** | 2026-09-06 | Major Architecture | Monorepo decoupling, `boundary.ts` pipeline, native Rust `tex` validator | [**Read v0.7.0 Notes →**](./changelog/v0.7/v0.7.0.md) |

---

## Current Release: [0.10.1] - 2026-10-23

> Fixes found building a new backend on 0.10.0 and deploying behind Cloudflare and Traefik. **Upgrade if you use `compression: true`**: compressed responses reached browsers as `204` with no body. Upgrade with `npm install exisjs@0.10.1` and `npm install -D @exisjs/cli@0.10.1`, then `npx exisjs migrate`. Check the behaviour changes first: `trustProxy: true` no longer reads `X-Real-IP`, a database that can't connect stops the start unless it is `required: false`, and `exisjs test` fails a test file whose process doesn't exit. Details in [**`changelog/v0.10/v0.10.1.md`**](./changelog/v0.10/v0.10.1.md).

### Fixed
- Compressed responses were sent as `204` with no body.
- `hpp()` turned arrays in JSON bodies into their last element.
- Boundary files loaded a second copy of every module they import under `NODE_ENV=test`.
- `exisjs test` hung without output when a test process didn't exit.
- Input was validated before the access check, so anonymous callers got `400`s that described the API.
- `csrf()` failed every state-changing request behind a reverse proxy.
- `trustProxy: true` trusted IP headers any client can set.
- `createRouter<Context>()` didn't pass its context to handlers.
- `npm prune` removed the `exisjs` command, so `npm start` failed.

### Added
- `trustProxy: 'cloudflare'` and `{ header }`; `csrf({ allowedOrigins })`; `mongoSanitize({ allowDots, exclude })`; `hpp({ whitelist })`; `logger.quietPaths`; `registerDatabase({ required: false })`; `requireUser()`; opt-in strict request types; `consume()` / `assertNotLimited()` for lockouts; `exisjs test --force-exit`.

## Previous Release: [0.10.0] - 2026-10-21

> The CLI moves to `@exisjs/cli`, production installs are about 10x smaller, and settings that did nothing now work or stop the start. Includes everything from the prereleases below. Upgrade with `npm install exisjs@latest` and `npm install -D @exisjs/cli@latest`, then `npx exisjs migrate`. Details and upgrade steps in [**`changelog/v0.10/v0.10.0.md`**](./changelog/v0.10/v0.10.0.md).

### Fixed (since beta.0)
- `exisjs migrate` flags `npm run build` without `--skip-env-check` when the `build` script is `exisjs build`, in a Dockerfile or `nixpacks.toml`.
- Successful health probes (`/health`, and `/_health` / `/_ready` with `healthcheck` on) log at `debug`, so a Docker `HEALTHCHECK` no longer fills the production log; failures still log.
- A database that fails to connect at `exisjs start` is logged as an error instead of hidden; the server starts and `/_ready` answers `503` until it is healthy.

## Prerelease: [0.10.0-beta.0] - 2026-10-20

> Feature-complete for 0.10.0. Install with `npm install exisjs@beta` and `npm install -D @exisjs/cli@beta`. Details in [**`changelog/v0.10/v0.10.0.md`**](./changelog/v0.10/v0.10.0.md#changes-in-0100-beta0).

### Fixed
- With `healthcheck` on, Ctrl+C in a terminal waited for the readiness drain (5 s in production) before stopping; it now stops at once. `SIGTERM`, and `SIGINT` without a terminal, still drain.

### Docs
- Deployment guide: `npm prune --omit=dev --omit=optional` also removes the `exisjs` command; use a clean `npm ci --omit=dev --omit=optional`, or run `npm rebuild exisjs` after pruning.

## Prerelease: [0.10.0-alpha.2] - 2026-10-20

> Fixes found by testing alpha.1. Details in [**`changelog/v0.10/v0.10.0.md`**](./changelog/v0.10/v0.10.0.md#changes-in-0100-alpha2).

### Fixed
- `server` set in `exis.config.ts` was ignored, and the uWS fallback warning never printed; an installed uWS that fails to load (glibc older than 2.38, as in `node:24-slim`) says so with its error; the "install `@exisjs/cli`" hints name the project's version instead of `latest`; on Windows, start-up errors showed a code frame from the framework's own files.

## Prerelease: [0.10.0-alpha.1] - 2026-10-20

> Fixes found by testing alpha.0. Details in [**`changelog/v0.10/v0.10.0.md`**](./changelog/v0.10/v0.10.0.md#changes-in-0100-alpha1).

### Added
- `healthcheck.drainMs`: on shutdown, `/_ready` answers `503` while the server keeps serving, then the listener closes (default 5000 in production).
- `create-exisjs --help`; `exisjs migrate` also checks `nixpacks.toml`, `Procfile` and the build line.

### Breaking
- uWebSockets.js is no longer installed with `exisjs`; apps with `server: 'uws'` install it: `npm install https://github.com/uNetworking/uWebSockets.js/archive/refs/tags/v20.71.0.tar.gz`.

### Fixed
- The `migrate` notice never appeared; a global CLI ran its own `exisjs`; `exisjs start` printed the development banner; a failing route in a built app was reported as the manifest; a wrong `queue` setting was found after the app's code ran; a failed build left a runnable `.exis/`.

## Prerelease: [0.10.0-alpha.0] - 2026-10-19

> Published with the npm tag `alpha`; `latest` stays on 0.9.2. Install with `npm install exisjs@alpha` and `npm install -D @exisjs/cli@alpha`. Details and upgrade steps in [**`changelog/v0.10/v0.10.0.md`**](./changelog/v0.10/v0.10.0.md).

### Breaking
- The CLI is in the new `@exisjs/cli` package (still installed with `exisjs` until 0.11); run `npx exisjs migrate`.
- `queue` rejects unknown keys and drivers other than `memory`; `tex.object()` rejects unknown options; outside development a route file that fails to load stops the start.

### Added
- `exisjs start` runs from the runtime, as one process, with no CLI installed (also `node .exis/server/main.js`); `exisjs migrate`; Prometheus `/metrics`; `queue` concurrency limits; `tex.object(..., { optional | nullable | nullish })`; size budget in CI.

### Fixed
- Graceful shutdown with a request in flight skipped `onClose` and the database disconnect; `partial()` reset unsent fields to their defaults; tests and routes used two copies of a module; `exisjs dev` ignored projects inside folders named `temp`, `data`, `build`...; Ctrl+C printed `EPIPE`; `ValidatorError` was not exported; the scaffold echoed passwords.

---

## Previous Release: [0.9.2] - 2026-10-17

> Development server fixes, a safe default environment, and a reworked validator and sanitizer module. Details in [**`changelog/v0.9/v0.9.2.md`**](./changelog/v0.9/v0.9.2.md).

### Fixed
- In `exisjs dev`, concurrent first requests to a route that had not loaded yet could get `404`; they now all wait for the same load.
- A route file that fails to load answers `500` with the error instead of leaving the request open, and the next request tries again.
- Route files no longer run twice when the dev server starts.

### Security
- `env` defaults to `'production'` when `NODE_ENV` is not set, so a server started with `node`, `tsx` or a process manager no longer sends error messages and stack traces to clients.

### Validator and sanitizers
- Nested objects, array items, records and unions get every rule a top-level field gets: sanitizers, refinements (sync and async), defaults, dates and strict mode.
- Schema methods (`optional`, `refine`, `sanitize`, ...) return copies, so shared field schemas no longer affect each other; `parse()` no longer modifies its input.
- A throwing sanitizer answers `400`, not `500`; `tex.literal(42)` no longer accepts `"42"`; enum values with commas work; `tex.date()` rejects unparsable values and always returns a `Date`; errors list every bad array item and nested field.
- New: `pattern`, `length`, `int`, `tex.url()`, `safeParse()`, object `.refine(fn, { path })`, `.default()`; sanitizers `stripControlChars`, `normalizeEmail`, `round`, `clamp`, `trimElements`, `limitLength`, `deepTrim`.
- `stripHtml` removes script content and keeps `a < b`; `preventTraversal` catches encoded `..`; `slugify` keeps accented letters.
- 4-5x faster for schemas with defaults or refinements, about 10x faster on invalid input.

### Added
- `dev.lazyRoutes: false` loads every route at startup in development.

---

## Previous Release: [0.9.1] - 2026-10-16

> Bug fixes for 0.9.0, no breaking changes. Details in [**`changelog/v0.9/v0.9.1.md`**](./changelog/v0.9/v0.9.1.md).

### Fixed
- A boundary `handle(ctx, next)` wrapper re-sent the route's response with `res.json`, so a returned `Buffer` became JSON and `res.json(5)` became text; a wrapper that returned nothing left the request open.
- `.optional()` on a nested `tex.object` was ignored (also through `partial()`, `extend()` and array items); `partial()` skipped nested objects; plain nested shapes crashed; array item errors were listed twice.
- `tex.object({ field: undefined })` now names the field in its error.
- The generated `AGENTS.md` points to `node_modules/exisjs/dist/docs/`; reference index links are relative; the `03-all-features` example no longer sends `X-Powered-By`.
- Binary request bodies (`req.buffer()`, `@RawBody()`) are kept byte for byte; `@RawBody()` answers `413` over the limit; the test client sends Buffers as bytes; `res.html()` sets `Content-Length`; the development-only `X-Set-Cookie` header (which exposed `httpOnly` cookies to scripts) is removed.

### Database
- `@Transactional` no longer exposes a transaction to concurrent requests on the same service (it now uses `AsyncLocalStorage`).
- `connectAll()` connects in parallel and reports every failure; health checks run in parallel with a per-database timeout (`healthTimeoutMs`) and shared in-flight checks.

### Conditional Requests
- New `res.checkPreconditions()` for `304` from a version column and `412` / `428` against lost updates.
- One RFC 9110 evaluator for automatic ETags, `serveStatic`, `res.download(path)` and `req.fresh`: `If-Match`, `If-Unmodified-Since`, `If-None-Match` (lists, weak tags, `*`), `If-Modified-Since`; `Last-Modified` on files; clean `304` headers; `Cache-Control: no-cache` no longer disables revalidation; `br;q=0` honoured; no `existsSync` in `serveStatic`; `fresh` dependency dropped.

### Changed
- 404s no longer scan every route; functional controllers precompute per-route work; `fast-json-stringify` loads on first use; unused pooling code removed; new `npm run bench:pipeline`.

### Added
- `.nullable()` and `.nullish()` on object schemas.

---

## Previous Release: [0.9.0] - 2026-10-14

> **Breaking changes before 1.0.** Fixes from two production field reports. Read the upgrade guide in [**`changelog/v0.9/v0.9.0.md`**](./changelog/v0.9/v0.9.0.md).

### ⚠️ Breaking Changes
- **`@Permissions` requires all listed permissions**; a role is never counted as a permission.
- **Anonymous callers get `401`** on routes with roles or permissions (was `403`).
- **`req.user.isSuperAdmin` no longer bypasses checks**; use `authorization.superUser`.
- **One error envelope** `{ success, statusCode, error: { code, message, details? } }`; the legacy top-level fields are removed (`errors.legacyFields: true` restores them for now) and `HttpError` details are no longer spread to the top level.
- **Cron jobs are not started under `NODE_ENV=test`**; use `app.cron.trigger(name)` or `createTestContext(app, { cron: true })`.
- **Helmet sends a default Content-Security-Policy.**
- **Return values**: `undefined` → `204`, `null` → JSON `null`, strings → `text/plain` in both paradigms.
- **Malformed JSON → `400 INVALID_JSON`** in class controllers and functional routes.

### Security
- Request-scoped providers were shared between requests; `@Injectable({ scope })` was ignored at boot.
- `@Idempotent` replayed one user's response to another and ignored a changed body (now `422`).
- Connection strings (`*_URL`, `*_URI`, `*_DSN`, `user:password@`) are redacted in validation errors and logs.
- A `beforeHandle` hook's `401` was overwritten with `403`.

### Fixed
- Class controllers: returned `res.json()` / `res.send()` / `download()` / `Buffer`, `@UseInterceptors` (handler ran twice, result ignored), rejections with `null` (were `404`).
- `HEAD` served by `GET` routes; `405` + `Allow` for a wrong method.
- Validation reports every failing field; functional validation logs show the mounted path.
- Cron jobs registered twice; dev error page (JSON for API clients, no ANSI, configured host, `.env` reload); dev lock per port; `tex.enum` readonly arrays; `default` fields typed as present after parsing; mixed paradigms fail `exisjs build`; template lint and broken functional guard template; `ExisUser` augmentation.

### Added
- `authorization.defaultPolicy: 'authenticated'` (deny by default), `authorization.superUser`, `errors.legacyFields`, `rateLimit({ store })`, `app.cron.lock`, `/_ready`, `requestId` on every `req.log` line, `ResolveInput` / `ResolveOutput`, ACCESS column in `exisjs routes`, test client `.query()` / `.timeout()`, `startTestServer()`, `exisjs dev --force`.

### Changed
- Class controllers do per-route work once at registration; their CPU cost per request is now close to functional routes.

### Tooling
- npm provenance on publish, `npm audit` gate in CI, scaffolded projects are linted by `verify:examples`.

---

## Previous Release: [0.8.1] - 2026-10-12

> **Security patch.** Upgrade if you use `ipFilter` or `serveStatic`. Details in [**`changelog/v0.8/v0.8.1.md`**](./changelog/v0.8/v0.8.1.md).

### ⚠️ Behavior Change
- **`ipFilter` uses `req.ip` only.** Behind a proxy, set `trustProxy` in `exis.config.ts`; otherwise allow-lists reject every request. The `trustProxy` option of `ipFilter` is deprecated and ignored.

### Security
- **`ipFilter` bypass**: allow-lists and deny-lists trusted a client-supplied `X-Forwarded-For` header by default.
- **`serveStatic` traversal**: files in a sibling directory sharing the root's name prefix (`public` and `public-private`) could be served.

### Fixed
- **`exisjs build` on hosts without `devDependencies`** (Render, Heroku): the type-check is skipped with a warning when `@types/*` packages are not installed, instead of failing with `Cannot find name 'process'`.

### Changed
- `dbSanitize()` reuses `mongoSanitize()`; no behavior change.

### Tooling
- Updated the `proxy-addr` development dependency (GHSA-jqcg-44mw-7w3h); not part of the published packages.

---

## Previous Release: [0.8.0] - 2026-10-09

> **Major release.** Read the breaking changes before upgrading. Full details, benchmarks and the upgrade guide are in [**`changelog/v0.8/v0.8.0.md`**](./changelog/v0.8/v0.8.0.md).

### ⚠️ Breaking Changes
- **`@exisjs/rs` removed**: The Rust N-API engine is gone and `exisjs` no longer depends on it. Direct imports from `@exisjs/rs` (including `signJwt`/`verifyJwt`) no longer work; ExisJS does not ship a built-in JWT implementation.
- **`trustProxy: <number>` uses Express hop semantics**: `trustProxy: N` trusts the N closest hops, counting the socket peer. The 0.7.x behavior let clients spoof `req.ip`. CDN IP headers are honored only with `trustProxy: true`.
- **`tex` enforces previously ignored rules**: `uuid`, `cuid`, `creditCard`, `literal`, `union` and `record` are now validated; `dedupe`, `slugify` and `collapseWhitespace` are applied; `email` rejects whitespace; `password` enforces `max`.
- **Multipart default limits**: 10 files, 100 fields, 200 parts, 1 MB per field, and all files together within `bodyLimit` (`413` when exceeded). Saved files are named `<field>-<uuid><ext>`.
- **Headers**: `helmet` config is now honored (including `enabled: false`); `X-XSS-Protection` is `0`; CORS allow-lists send `Vary: Origin`.
- **Request IDs**: client-supplied IDs must be at most 128 token characters, otherwise one is generated.
- **Error responses**: `error` is always an object (`{ code, message, details? }`) and every error includes `statusCode`. Validation errors no longer return `error: "Bad Request"`; the existing `message`, `validationErrors`, `errors` and `details` fields are kept.
- **Middleware before validation**: route middleware and `@Use(...)` now run before body/query/param validation, so authentication answers first.
- **Constructor injection**: undecorated constructor parameters on controllers and `@Injectable()` classes throw a descriptive error; use `@Inject(Token)`.
- **`exisjs test`** fails when no tests are found or a test file crashes on load.
- **Node.js 20+** is required (`engines` field on all packages).

### Added
- **Compiled `tex` validator**: Schemas compile once into plain JS check functions. Each schema compiles to a generated JavaScript function; a 3-field parse takes about 0.05 µs, faster than Ajv on the same benchmark.
- **Zod query/param coercion**: `z.number()`, `z.boolean()` and `z.date()` fields in `query`/`params` object schemas are converted from strings automatically (Zod 3 and 4).
- **`download()` helper** (`exisjs/response`) to return attachments from handlers, and **`InferRouteInput` / `InferRouteOutput`** types (`exisjs/router`).
- **Shutdown signal** passed to `app.onShutdown(signal)` and `onApplicationShutdown(signal)`.
- **Upload hardening**: Combined-size cap, field/part/file count limits, partial-file cleanup on failure, and `streamUpload()` resolves only after files are written.
- **Bounded in-memory caches** for `@Cacheable` (50,000 entries) and idempotency (10,000 entries).
- **Standard package metadata**: `homepage`, `bugs`, `repository.directory`, `engines`, `publishConfig`, `./package.json` export, and a `LICENSE` file per package.

### Changed
- **Request pipeline performance**: JS radix router with a static exact-match table (7x faster lookups than native), `JSON.parse` body parsing with prototype-pollution stripping (7x faster), validators compiled per route instead of per request, fewer per-request listeners and closures. Framework overhead per request is roughly halved and end-to-end CPU per request drops 9–18%.
- **Compression** uses Node's async `zlib` (Brotli quality 4) off the event loop, preserves existing `Vary`, and skips already-encoded and `no-transform` responses.
- **All packages versioned `0.8.0`**; `create-exisjs` scaffolds projects on `exisjs@^0.8.0`.

### Fixed
- **Boundaries ignored in production**: `boundary.ts` guards, middleware, CORS, headers and providers were skipped after `exisjs build`; a boundary that failed to load was also skipped silently. Both fixed.
- **Passwords in logs**: validation diagnostics logged received values of credential fields; they are now redacted in logs, responses and `tex.env` errors.
- **Invalid CORS**: a wildcard origin is never sent together with `Access-Control-Allow-Credentials`.
- **`/docs` in production** now follows `docs.enabled`.
- **`createTestContext(exis({...}))`** skipped `onStart` and booted the app twice; tests could also load a stale build manifest.
- **`plugins` in `exis.config.ts`** were dropped when `exis({ plugins })` was used.
- **`create-exisjs`**: the class-based project did not compile and the generated test was never run.
- **Cross-request data exposure**: Removed request/response object pooling, which could hand a late-running handler the next user's request.
- **Shared route params**: Each route match now gets its own params object; previously one cached object was shared and mutated across requests.
- **Upload path traversal**: Multipart field names can no longer write files outside the upload directory.
- **Errors thrown in apps without middleware** reached the 404 handler instead of the error handlers.
- **Malformed `%` escapes** in path parameters return `400` instead of `500`.
- **Bun graceful shutdown** waited for its timeout because completed requests were never counted down.
- **Rate-limit reset headers** now report the actual window end.
- **`Called end on pool more than once` on shutdown**: registered databases were disconnected immediately on `SIGINT`/`SIGTERM` (before requests drained) and again during graceful shutdown. They are now disconnected once, after draining.
- **`res.download()` crashed** with `contentDisposition is not a function` on every call.
- **`res.download(string)` path guessing**: a string is now always a file path, never content, and a new `root` option confines request-supplied filenames to one directory (traversal answers `404`).
- **Route param names** differing at the same position (`/stock/:id`, `/stock/:stockId/items`) now each resolve to the name their route declared.
- **Returned `Buffer`s** are sent as bytes instead of being JSON-encoded.
- **Stale build output**: `dist/` is cleaned before each build so removed modules cannot be published.

### Tooling
- **Benchmark suite rewritten**: four parity scenarios across six targets with response verification, warmup, interleaved rounds, and server CPU per request; `npm run bench:profile` for V8 CPU/heap profiles; router and validation micro-benchmarks. See [`bench/README.md`](./bench/README.md).
- **`npm run typecheck`** covers package sources, tests and benchmarks; CI runs lint and typecheck before tests.

### Removed
- `@exisjs/rs`, its Rust sources and the N-API cross-compilation pipeline (CI no longer installs Rust).
- `NativeRadixTree` and the native-engine check in `exisjs doctor`.

---

## Previous Release: [0.7.14] - 2026-10-05

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.14.md`**](./changelog/v0.7/v0.7.14.md).

### Added
- **Enhanced Binary, Buffer & Stream `res.download()` Response Helper**: Extended `res.download()` on `ExisResponse` to handle Buffers, Node.js Readable streams, Web ReadableStreams, strings, and file paths with automatic `Content-Disposition` and `Content-Type` header setting.

### Fixed
- **Windows Path Quoting & Space Handling in Subprocess Spawning (`exis run` / `exis exec`)**: Configured direct Node execution to use `shell: false` and `windowsHide: true`, resolving `C:\Program is not recognized` failures when Node is installed in directories containing spaces.
- **File-System Route Specificity & Radix Tree Segment Ordering**: Updated directory scanner to prioritize static paths over dynamic wildcard `[id]` and catch-all `[...slug]` segments, eliminating route shadowing.
- **Windows Libuv Shutdown Assertion & `write EPIPE`**: Safely disconnected active IPC channels via `process.disconnect()` prior to tearing down database pools and HTTP handles, suppressing broken pipe errors on exit and preventing `!(handle->flags & UV_HANDLE_CLOSING)` crashes.
- **Type Resolution Strictness**: Fixed optional/nullable type markers in `TexEngine` and route definitions to prevent unexpected union type collapsing.

---

## Previous Release: [0.7.13] - 2026-10-02

### Added
- **`tex.discriminatedUnion` Polymorphic Schema Branching**: First-class polymorphic schema validation matching literal/enum discriminant tags across sync/async parsing with OpenAPI 3.1 `oneOf` and `discriminator` generation.
- **`tex` Schema Composition (`extend`, `merge`, `pick`, `omit`)**: Added `.extend()`, `.merge()`, `.pick()`, and `.omit()` on `TexEngine` for clean modular schema building with full TypeScript inference.
- **Field and Schema Data Transformations**: Added `TexType.prototype.transform(fn)` for post-validation field mappings and `TexEngine.prototype.transform(fn)` for schema output reshaping.
- **Explicit Coercion Primitives (`tex.coerce.*`)**: Added `tex.coerce.number()`, `tex.coerce.boolean()`, `tex.coerce.date()`, and `tex.coerce.string()`.
- **Universal Multi-Validator OpenAPI 3.1 Duck Typing**: `schemaToOpenApi()` seamlessly translates `TexEngine`, `TexType`, and external schema libraries like **Zod** (`ZodString`, `ZodNumber`, `ZodBoolean`, `ZodDate`, `ZodEnum`, `ZodLiteral`, `ZodArray`, `ZodOptional`, `ZodNullable`, `ZodUnion`, `ZodDiscriminatedUnion`, `ZodRecord`, `ZodEffects`, `ZodObject`), raw JSON Schema, and plain property maps with zero boilerplate.
- **Field Documentation Metadata**: Added `.describe(description)` and `.example(value)` fluent methods on `TexType`.
- **`@RawBody()` Controller Parameter & `req.buffer()`**: Added `@RawBody()` decorator for OOP controllers and `req.buffer()` on `ExisRequest` for high-throughput webhook payload streaming and verification.
- **Dependency Injection Custom Providers & Contextual `inject()`**: First-class support for `useValue`, `useFactory` (with `inject` token dependencies), `useExisting` aliases, and `useClass` across `app.provide()`, `@Module()`, and `defineModule()`.

### Fixed
- **Controller Pipe Evaluation Precedence**: Fixed pipe resolution order in `controller-registrar.ts` so schema validation (`.parse()`) executes properly when passed to `@Body()`, `@Query()`, `@Param()`.
- **Automatic Query/Param String Coercion**: Ensured string query/path parameters auto-coerce to primitives when schemas are attached as parameter pipes.
- **TypeScript TS2300 Duplicate Identifier Fix**: Renamed internal example storage property in `TexType` to avoid collision with the fluent builder method `example()`.

---

## Previous Release: [0.7.12] - 2026-10-02

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.12.md`**](./changelog/v0.7/v0.7.12.md).

### Added
- **Automatic Database Boot Connection (`DatabaseManager.connectAll`)**: Registered databases (`registerDatabase`) are now automatically connected during startup across `app.create()`, `defineApp().boot()`, `start-server` (before listening), and `createTestApp` with internal connection state deduplication (`_connected`).
- **Dual Callback Support for Database Health Checks (`isHealthy` & `healthCheck`)**: `DatabaseRegistration` and `DatabaseManager.checkHealth()` now support both `isHealthy` and `healthCheck` callback properties interchangeably.
- **`exisjs routes` CLI Subprocess Module Resolution**: Dynamic route introspection now executes through a TypeScript-aware subprocess with `tsx` runner and path alias loader, resolving `file:///...` module import issues on Windows and TypeScript projects.
- **New `exis run` (alias `exis exec`) CLI Command**: Automatically loads `.env`, `.env.local`, and mode files before running any TypeScript script or external tool (e.g. `exis run drizzle-kit push`, `exis run scripts/seed.ts`).
- **Production Manifest Dedicated `src/cron/` Bundling**: `generateManifest` in `manifest.ts` now prioritizes the compiled `outDir` directory in production builds, eliminating duplicate source file references and resolving `BUILD_VALIDATION_FAILED` errors on projects with dedicated `src/cron/*` tasks.
- **Standardized Cron Job Mounting Logs**: Replaced verbose multiline cron mounting logs with clean, single-line structured outputs including job name, schedule expression, and relative file path (`Mounted cron "<jobName>" (<schedule>) -> <relFile>`).
- **Starter Scaffolding `tsconfig.json` Expansion**: Expanded `tsconfigTemplate` in `create-exisjs` to include `"types": ["node"]` and include root `'*.config.ts'`, `'*.config.js'`, and `'*.ts'` patterns, preventing `TS2580: Cannot find name 'process'` in standalone tools like `drizzle.config.ts`.
- **Documentation & Type Synchronization**: Corrected `docs/reference/database.mdx` with exact signatures for `registerDatabase` and return types for `DatabaseManager.checkHealth()`.
- **Scaffolding Dependency Updates**: Starter templates in `create-exisjs` now target `exisjs: '^0.7.12'`.

---

## Previous Release: [0.7.11] - 2026-10-01

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.11.md`**](./changelog/v0.7/v0.7.11.md).

### Added
- **Static Route In-Memory Fast Path**: `NativeRadixTree` builds an exact static lookup map (`staticCache`) for parameterless routes, bypassing tree traversal and pushing server throughput over 51,000 req/sec.
- **Zero-Allocation `AbortSignal` Lazy Instantiation**: `ExisRequest.prototype.signal` is now created only when accessed, reducing garbage collection overhead and event listeners on standard requests.
- **High-Performance uWS Adapter Parity**: Full EventEmitter and lifecycle method parity on `UwsIncomingMessage`, `UwsServerResponse`, and `UwsWebSocketShim` (`.once()`, `.off()`, `.removeListener()`, `.removeAllListeners()`, `.destroyed`, `.writableEnded`, `.writeHead()`, `.getHeaders()`, `.getHeaderNames()`, `.flushHeaders()`).
- **Timing-Safe String / Buffer Comparison (`timingSafeEqual`)**: Constant-time comparison in `exisjs/middleware` for API keys, tokens, and HMAC signatures with dummy comparisons preventing length-leak timing attacks.
- **Configurable Dev Server Watcher**: Added `dev` options to `defineConfig` (`watch`, `ignored`, `usePolling`, `interval`, `binaryInterval`) for container, VM, and Windows file-watching workflows.
- **Flexible Database Lifecycle Registration**: `registerDatabase` supports both `(options)` and `(app, options)` signatures.
- **CLI Scaffolding Alignments (`create-exisjs`)**: Updated template generator for `src/cron/cleanup.ts` with `cron()` and `@Cron()` and bumped dependencies to `^0.7.11`.

---

## Previous Release: [0.7.10] - 2026-09-27

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.10.md`**](./changelog/v0.7/v0.7.10.md).

### Added
- **Class Controller Inheritance (Base & Abstract Controller Support)**: Route discovery, parameters, middlewares, guards, interceptors, and filters across full prototype chains.
- **Property-Level `@Inject()` & `@Optional()` Decorators**: Direct field injection with TypeScript `design:type` reflection fallback.
- **Forward References & Circular Dependency DI Resolution (`forwardRef`)**: Lazy ES6 proxy-based cyclic resolution for singleton providers.
- **Built-in Parameter Transformation Pipes & `@UsePipes`**: `ParseIntPipe`, `ParseFloatPipe`, `ParseBoolPipe`, `ParseUUIDPipe`, `ParseArrayPipe`, `ValidationPipe`, and `@UsePipes()`.
- **`@Global()` Module Decorator**: Global provider and module exports without re-importing across modules.
- **Automatic Constructor Parameter Type Reflection (`design:paramtypes`)**: In OOP controllers and services, ExisJS inspects `design:paramtypes` and auto-resolves constructor classes directly from `INJECTABLE_REGISTRY` without requiring boilerplate `@Inject()`.
- **Built-in Safe Response Serializer (`safeSanitize`)**: Zero-crash JSON response serialization in the HTTP response pipeline. Automatically unwraps Mongoose documents (`.toObject({ virtuals: true, getters: true })`), BSON types (`ObjectId`, `Decimal128`, `Long`, `Binary`), `BigInt` (to string), `Date` (to ISO 8601), and `Map`/`Set`.
- **Enhanced Serialization Diagnostics**: Detailed property path tracking (e.g. `'recentTransactions[0].accountId'`) for clear debugging of un-serializable properties.
- **Automatic Query Parameter Type Coercion**: Query schemas with `tex.number()` and `tex.boolean()` automatically coerce numeric and boolean query strings (`"100"` $\to$ `100`, `"true"` $\to$ `true`).
- **Standardized Error Response Envelope**: Standardized framework error responses into a consistent JSON envelope (`success: false`, `statusCode`, `error`, `message`, `validationErrors`, `errors`, `timestamp`).
- **Reverse Proxy & Multi-CDN IP Resolution**: Evaluates `CF-Connecting-IP`, `True-Client-IP`, `X-Real-IP`, and `X-Client-IP` before `X-Forwarded-For` when `trustProxy: true` (or `process.env.TRUST_PROXY === 'true'`).
- **Smart ETag Disabling**: Set `etag: false` by default for dynamic API routes to eliminate redundant SHA-1 computation overhead and clarify dev response log timings.
- **Test Harness Options**: Enhanced `createTestApp` client HTTP methods to accept optional request options (such as custom request headers).

---

## Previous Release: [0.7.9] - 2026-09-24

> For full technical details and code examples, see [**`changelog/v0.7/v0.7.9.md`**](./changelog/v0.7/v0.7.9.md).

### Added
- **Enterprise OOP Architecture Decorators**:
  - Security & Authorization: `@Permissions()`, `@Roles()`, `@Public()` (`@IsPublic()`, `@AllowAnonymous()`) with automatic `isSuperAdmin` bypass.
  - Service Lifecycle Hooks: `OnInit`, `OnDestroy`, `OnModuleInit`, `OnModuleDestroy`, `OnApplicationBootstrap`.
  - Native Off-Heap Method Caching: `@Cacheable()` and `@CacheEvict()` powered by Rust `NativeMemoryCache`.
  - Automated Transactions: `@Transactional()` supporting ExisJS DB, Prisma, Drizzle, TypeORM, Knex, and connection pools.
  - Sub-Millisecond Profiling: `@Profile()` decorator with SLA threshold warnings.
  - Declarative Exception Filtering: `@Catch(...exceptions)` and `@UseFilters()` with `ExceptionFilter` and `ArgumentsHost`.
  - Dual Class/Type Exception Declarations: Subclassed `NotFoundException`, `UnauthorizedException`, `ForbiddenException`, `BadRequestException`, `ConflictException`, `PayloadTooLargeException`, `UnprocessableException`, `RateLimitException`, `InternalException`.

### Fixed
- **Route Method Schema Normalization**: Fixed `TS(2559)` by automatically normalizing raw `TexEngine`/Zod schemas and wrapped `{ body, query, params, headers }` objects in `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, etc.
- **Async Generator Type Safety**: Added explicit `Promise<T>` return types across all starter templates to prevent `TS(1064)`.
- **Test Harness Types & Boot Memoization**: Enabled `createTestApp` and `createTestContext` to seamlessly accept `ExisConfig` and `ExisAppDefinition` without `TS(2345)`.
- **Dev Watcher Lockfile Loop**: Enhanced `chokidar` in `exis dev` to ignore lockfiles, dotfiles, and build caches, eliminating restart loops during `npm install`.
- **ESM Multiline Import Path Resolution**: Fixed regex in `resolve-aliases.ts` to correctly append `.js` extensions on multiline import and export statements during `exis build`.
- **Scaffolding Template Alignment**: Standardized `exis.config.ts` generator template to export `const config: ExisConfig` and `export default config`.




# Contributing to ExisJS

Thank you for your interest in ExisJS. Bug reports, fixes, documentation, tests and benchmarks are all welcome. This guide explains how to get set up, what we expect from a change, and how it gets reviewed and released.

**Quick links:** [Issues](https://github.com/v25group/exisjs/issues) · [Discussions](https://github.com/v25group/exisjs/discussions) · [Security policy](./SECURITY.md) · [Code of Conduct](./CODE_OF_CONDUCT.md) · [Architecture](./docs/ARCHITECTURE.md)

## Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Development Setup](#development-setup)
- [Making a Change](#making-a-change)
- [Coding Guidelines](#coding-guidelines)
- [Tests](#tests)
- [Performance Changes](#performance-changes)
- [Changes That Need Approval First](#changes-that-need-approval-first)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Release Process (Maintainers)](#release-process-maintainers)
- [License](#license)

## Code of Conduct

Everyone taking part in this project is expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Be respectful, assume good intent, and keep discussions about the work.

## Ways to Contribute

| You want to... | Do this |
| :--- | :--- |
| Ask a question or share an idea | Start a thread in [GitHub Discussions](https://github.com/v25group/exisjs/discussions). |
| Report a bug | [Open an issue](https://github.com/v25group/exisjs/issues/new/choose) with the **Bug report** template. Include the ExisJS and Node.js versions and a minimal reproduction. |
| Propose a feature | [Open an issue](https://github.com/v25group/exisjs/issues/new/choose) with the **Feature request** template and describe the problem it solves before writing code. |
| Fix a bug or implement an agreed feature | Comment on the issue so others know you are working on it, then open a pull request. |
| Improve the documentation | Edit the files in [`docs/`](./docs/) and open a pull request. Small fixes need no issue. |
| Report a security vulnerability | **Do not open a public issue.** Follow [SECURITY.md](./SECURITY.md). |

Search existing issues and discussions first; the problem may already be known or in progress.

## Development Setup

**Requirements:** Node.js 20 or newer (the version in [`.node-version`](./.node-version) is the one CI uses) and npm. ExisJS has no native add-ons, so you do not need Rust, Python or a C++ toolchain.

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/exisjs.git
cd exisjs

# 2. Install dependencies for every package (npm workspaces)
npm install

# 3. Build, then run the checks CI runs
npm run build
npm run lint
npm run typecheck
npm test
```

`npm install` also installs a Git pre-commit hook (Husky + lint-staged) that runs ESLint and Prettier on the files you commit.

### Repository Layout

| Path | Contents |
| :--- | :--- |
| `packages/exisjs` | The framework: server, router, validator, DI, middleware, CLI, testing utilities |
| `packages/create` | `create-exisjs`, the project scaffolder |
| `packages/fetch` | `@exisjs/fetch`, the HTTP client |
| `packages/*/tests` | Tests for each package |
| `docs/content`, `docs/reference` | Guides and API reference (shipped inside the `exisjs` package) |
| `examples/` | Example applications, checked by `npm run verify:examples` |
| `bench/` | HTTP and micro-benchmarks, see [`bench/README.md`](./bench/README.md) |
| `changelog/` | Release notes, one file per release |

### Useful Scripts

| Command | What it does |
| :--- | :--- |
| `npm run build` | Compiles all packages into their `dist/` folders |
| `npm test` | Runs every test in the monorepo |
| `npm run test:watch` | Re-runs tests on change |
| `npm run lint` | ESLint over sources, tests and benchmarks |
| `npm run typecheck` | Type-checks sources, tests and benchmarks (tests run through `tsx`, which does not check types) |
| `npm run verify:examples` | Type-checks, tests, builds and starts the examples and freshly scaffolded projects |
| `npm run bench:quick` | Short HTTP benchmark, about 3 minutes |
| `npm run bench:pipeline` | Per-request framework cost without the network |

To run a single test file: `npx cross-env NODE_ENV=test tsx --test packages/exisjs/tests/router.test.ts`.

## Making a Change

1. **Start from an issue** for anything larger than a small fix, so the approach can be agreed before you invest time.
2. **Create a branch** from `main` named after the change, for example `fix/head-request-body` or `feat/validator-pattern`.
3. **Make the change** in the right package, with tests (see [Tests](#tests)).
4. **Update the documentation** in `docs/` whenever behaviour or a public API changes. Examples in the docs must work as written.
5. **Run the checks** CI runs: `npm run lint`, `npm run typecheck` and `npm test`. Run `npm run verify:examples` if you changed the CLI, the scaffolder or anything an example uses.
6. **Commit** following [Commit Messages](#commit-messages) and open a pull request.

Do not edit version numbers, `CHANGELOG.md` or the files in `changelog/`; maintainers write the release notes from your pull request description.

## Coding Guidelines

- **TypeScript, strict mode.** Avoid `any` in public types; prefer precise types that make wrong usage fail to compile.
- **Formatting is automatic.** Prettier and ESLint run on commit; do not reformat code you are not changing.
- **Keep the request path lean.** Work that can be done once (at startup or when a route is registered) should not be repeated on every request.
- **No new runtime dependencies** in `packages/exisjs` without approval (see below). Prefer Node.js built-ins.
- **Errors use the standard envelope.** Throw `HttpError` (or a subclass) so responses keep the `{ success, statusCode, error: { code, message } }` shape.
- **Comments explain why, not what.** Document public APIs with TSDoc, including an example.
- **Security-sensitive input** (headers, paths, bodies, file names) is validated at the boundary. When in doubt, ask in the pull request.

## Tests

- Every bug fix comes with a test that **fails without the fix**.
- Every new feature comes with tests for the main path and the edge cases (invalid input, empty values, concurrency where relevant).
- Tests live in `packages/<package>/tests` and use the built-in test utilities from `exisjs/testing`.
- Test behaviour through the public API (`createTestApp(app).get(...)`) rather than internal functions where possible, so refactors do not break tests.
- A test must not depend on timing luck, the network or another test's state. Clean up temporary files and registered resources.
- Type-level behaviour (inferred types) is covered by type assertions checked by `npm run typecheck`.

## Performance Changes

If your change touches the request path (`src/server`, `src/router`, `src/validator`, `src/middleware`), measure it before and after and include the numbers in your pull request:

- `npm run bench:pipeline` for per-request framework cost, accurate to about 0.2 µs. Use `EXIS_DIST=<path>` to compare against a baseline build.
- `npm run bench:quick` for end-to-end numbers. Compare the **Server CPU / req** column, which is far more stable than req/s on a laptop.
- `npm run bench:router` and `npm run bench:validation` for micro-benchmarks, and `npm run bench:profile` to see where CPU time goes.

See [`bench/README.md`](./bench/README.md) for the methodology. Do not commit `docs/BENCHMARKS.md`; maintainers regenerate it at release time.

## Changes That Need Approval First

Open an issue and wait for a maintainer to agree before working on:

1. **The HTTP and routing core** (`src/server`, `src/router`). It is performance-critical; changes need benchmark numbers.
2. **Breaking changes to public APIs**, such as `exis()`, `req`, `res`, `tex`, decorators or dependency injection.
3. **New runtime dependencies or native add-ons** in `packages/exisjs`. The core is pure TypeScript by design; see "Why There Is No Native Engine" in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

Never commit generated files: `dist/`, `.exis/`, `coverage/`, `bench/results/`, `bench/.profiles/` or `.env` files.

## Commit Messages

Each commit explains **what** changed, **why**, and **how**, so reviewers and future maintainers can understand it without the pull request.

```text
type(scope): Subject in the imperative, under 50 characters

What:
- The changes this commit makes.

Why:
- The problem it solves or the feature it adds, and why this approach.

How:
- The implementation, edge cases handled, and decisions worth knowing.
```

**Types:** `feat` (new feature), `fix` (bug fix), `perf` (performance), `refactor`, `docs`, `test`, `chore` (tooling, dependencies), `ci`.

**Scopes:** the area changed, for example `core`, `router`, `validator`, `middleware`, `cli`, `create`, `fetch`, `bench`, `docs`. Omit it for repo-wide changes.

Mark a breaking change with `!` after the type or scope (`feat(router)!: ...`) and describe the migration in the body.

### Example

```text
fix(middleware): Use req.ip in ipFilter

What:
- ipFilter checks req.ip instead of reading X-Forwarded-For itself.
- Its own trustProxy option is deprecated and ignored.
- Regression tests for spoofed X-Forwarded-For headers.

Why:
- ipFilter trusted X-Forwarded-For on its own terms, so a client could
  bypass an allow or deny list by sending the header itself.

How:
- req.ip already follows the app-level trustProxy setting, so the
  middleware and the rest of the app now agree on the client address.
- Without trustProxy the header is ignored entirely.
```

## Pull Requests

- Fill in the pull request template: what changed, why, how you tested it, and any breaking change.
- Keep a pull request focused on one change. Unrelated fixes go in separate pull requests.
- CI must pass: the production dependency audit, lint, type check, tests, and `verify:examples`.
- A maintainer reviews every pull request. Expect questions and requested changes; push new commits to the same branch to address them.
- Maintainers may squash commits when merging; the final commit message then follows the format above.

## Release Process (Maintainers)

1. Set the same version in `packages/exisjs`, `packages/create`, `packages/fetch` and the root `package.json`, update the `exisjs` version that `create-exisjs` scaffolds (`packages/create/src/templates.ts`), and run `npm install` to refresh the lockfile.
2. Write the release notes in `changelog/vX.Y/vX.Y.Z.md`, and add the release to `CHANGELOG.md` and to the table in `changelog/README.md`. Breaking changes go first, with an upgrade guide.
3. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run verify:examples`.
4. For minor and major releases, regenerate the published benchmarks on a quiet machine: `npm run bench -- --write`.
5. Commit, push to `main`, wait for CI, then tag and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

Pushing the tag runs the publish workflow, which builds, tests and publishes the packages to npm with provenance and creates the GitHub release from `changelog/**/vX.Y.Z.md`. The tag name must match the release notes filename. A published version cannot be republished; fix forward with a new patch release.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](./LICENSE).

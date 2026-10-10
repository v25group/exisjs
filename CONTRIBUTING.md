# Contributing to Exis

First off, thank you for considering contributing to Exis JS! It's people like you that make this framework such a great tool.

## Development Setup

**Requirements:** Node.js 20 or newer and npm. Nothing else: ExisJS has no native add-ons, so you do not need Rust, Python or a C++ toolchain.

1. **Fork & Clone**: Fork the repository on GitHub and clone your fork locally.
2. **Install Dependencies**: Run `npm install` in the root directory.
3. **Build the packages**: Run `npm run build` from the root directory. This will compile the TypeScript code into the `dist/` folders.
4. **Run Tests**: Make sure all tests are passing by running `npm test`. We have a suite of over 600 tests across the monorepo that must remain green.

| Command | What it does |
| :--- | :--- |
| `npm run build` | Compiles all packages into their `dist/` folders |
| `npm test` | Runs every test in the monorepo |
| `npm run lint` | ESLint over sources, tests and benchmarks |
| `npm run typecheck` | Type-checks sources, tests and benchmarks (tests run through `tsx`, which does not check types) |
| `npm run bench:quick` | Short HTTP benchmark, about 3 minutes |

## Making Changes

1. Create a new branch: `git checkout -b feature/your-feature-name`
2. Make your changes in the appropriate package (`packages/exisjs`, `packages/create`, `packages/fetch`).
3. If you add a new feature, please add a corresponding test in the `tests/` directory.
4. If you fix a bug, add a test that fails without your fix.
5. Ensure `npm run lint`, `npm run typecheck` and `npm test` all pass. CI runs the same three checks.
6. Update the docs in `docs/` when behavior or a public API changes.

### Performance Changes

If your change touches the request path (`src/server`, `src/router`, `src/validator`, `src/middleware`), measure it before and after and include the numbers in your PR:

- `npm run bench:quick` for end-to-end numbers. Compare the **Server CPU / req** column, which is far more stable than req/s on a laptop.
- `npm run bench:router` and `npm run bench:validation` for micro-benchmarks.
- `npm run bench:profile` to see where CPU time goes.

See [`bench/README.md`](./bench/README.md) for the methodology. Do not commit `docs/BENCHMARKS.md`; maintainers regenerate it at release time.

### What NOT to Change (Strict Boundaries)

To maintain the architectural integrity and performance of Exis JS, please **do not modify** the following without explicit prior approval from the core team (via an approved GitHub Issue):

1. **The Core HTTP & Routing Engine (`src/router` & `src/server`)**: The request lifecycle and the radix-tree router are performance-critical. Any change here must come with benchmark numbers (see Performance Changes above).
2. **Public API Signatures**: Do not introduce breaking changes to user-facing APIs (like `exis()`, `req`, `res`, `tex`, or dependency injection).
3. **Native Add-ons and Runtime Dependencies**: Do not add native (N-API, Rust, C++) modules, and do not add runtime dependencies to `packages/exisjs` without approval. The core is pure TypeScript by design; see "Why There Is No Native Engine" in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
4. **Version Numbers (`package.json`)**: Do not manually bump version numbers in the `package.json` files. Version bumps and releases are handled exclusively by the maintainers (see Release Process below).
5. **Generated Files**: Do not commit anything inside the `dist/`, `.exis/`, `coverage/`, `bench/results/` or `bench/.profiles/` directories. These are generated automatically.

## Commit Message Guidelines

We enforce a strict, professional commit message format. A great commit message provides context for the reviewer and future maintainers. Every commit must clearly answer the **What**, **Why**, and **How** of the change.

**Types:** `feat` (new feature), `fix` (bug fix), `perf` (performance), `refactor`, `docs`, `test`, `chore` (tooling, dependencies), `ci`.

**Scopes:** the area you changed, for example `core`, `router`, `validator`, `middleware`, `cli`, `create`, `fetch`, `bench`, `docs`. The scope may be omitted for repo-wide changes.

### Format

```text
type(scope): Subject line under 50 characters

What:
- Briefly describe the exact changes made in this commit.

Why:
- Explain the problem this commit solves or the feature it introduces.
- Include context on why this specific approach was taken.

How:
- Detail the technical implementation.
- Mention any edge cases handled or architectural decisions made.
```

### Example

```text
feat(router): Implement zero-allocation Radix Tree path matching

What:
- Replaced the legacy linear RegExp-based router with a deterministic Radix Tree (`RadixNode`).
- Added a highly optimized `matchRoute` algorithm that resolves dynamic params (`:id`) and wildcards (`*`) without instantiating new arrays or objects.
- Introduced a suite of macro and micro benchmarks using `autocannon` to prevent future regressions.
- Deprecated the `Router.useRegex()` configuration method in favor of the new default engine.

Why:
- The previous routing implementation relied heavily on dynamically compiled Regular Expressions, which scaled linearly (O(n)). For enterprise APIs with >1,000 endpoints, this resulted in severe CPU spikes and degraded P99 latency under heavy load.
- Real-world production telemetry showed that 12% of request time was spent purely on URI regex evaluations before a handler was even invoked.
- A Radix Tree guarantees O(k) lookups (where k is the length of the path segments), completely flattening the performance curve regardless of how large the API surface grows.

How:
- Implemented the `RadixNode` class in `src/router/tree.ts` utilizing a heavily-optimized JavaScript `Map` for static segment traversal.
- Wrote a custom parameter extractor that iterates over the raw URL string byte-by-byte using `charCodeAt` to completely eliminate garbage collection overhead during request routing.
- Edge Case Handled: Wildcard nodes (`*`) are now strictly evaluated with the lowest priority, ensuring static paths (`/api/users/me`) properly bypass dynamic conflict nodes (`/api/users/:id`).
- Added 100% test coverage across 40 edge-case scenarios, specifically testing nested parameters (`/v1/:orgId/users/:userId/roles`) and trailing slashes.
```

## Submitting a Pull Request

1. **Versioning**: Versioning and releasing are handled manually by the maintainers. Do not increment package versions in your PR.
2. Ensure `npm run lint`, `npm run typecheck` and `npm test` all pass.
3. Write a concise summary of your changes in the PR description. Call out any breaking change clearly, and include benchmark numbers for performance-sensitive changes.
4. Push to your fork and submit a Pull Request.

## Reporting Security Issues

Do not open a public issue for a security vulnerability. Follow the private reporting process in [SECURITY.md](./SECURITY.md).

## Release Process (Maintainers)

1. Set the same version in `packages/exisjs`, `packages/create`, `packages/fetch` and the root `package.json`, then update the `exisjs` version that `create-exisjs` scaffolds (`packages/create/src/templates.ts`) and run `npm install` to refresh the lockfile.
2. Write the release notes in `changelog/vX.Y/vX.Y.Z.md`, add the release to `CHANGELOG.md` and to the table in `changelog/README.md`. Breaking changes go first, with an upgrade guide.
3. Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.
4. For minor and major releases, regenerate the published benchmarks on a quiet machine: `npm run bench -- --write`.
5. Commit, push to `main`, then tag and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

Pushing the tag runs the publish workflow, which builds, tests and publishes the packages to npm and creates the GitHub release from `changelog/**/vX.Y.Z.md`. The tag name must match the release notes filename.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md). We expect all contributors to follow these guidelines to ensure a welcoming environment for everyone.

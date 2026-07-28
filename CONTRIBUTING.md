# Contributing to Exis

First off, thank you for considering contributing to Exis JS! It's people like you that make this framework such a great tool.

## Development Setup

1. **Fork & Clone**: Fork the repository on GitHub and clone your fork locally.
2. **Install Dependencies**: Run `npm install` in the root directory.
3. **Build the packages**: Run `npm run build` from the root directory. This will compile the TypeScript code into the `dist/` folders.
4. **Run Tests**: Make sure all tests are passing by running `npm run test`. We have a suite of over 300 tests that must remain green.

## Making Changes

1. Create a new branch: `git checkout -b feature/your-feature-name`
2. Make your changes in the appropriate package (`packages/exis` or `packages/create-exis`).
3. If you add a new feature, please add a corresponding test in the `tests/` directory.
4. Ensure your code passes the linter by running `npm run lint`.

### What NOT to Change (Strict Boundaries)

To maintain the architectural integrity and performance of Exis JS, please **do not modify** the following without explicit prior approval from the core team (via an approved GitHub Issue):

1. **The Core HTTP & Routing Engine (`src/router` & `src/http`)**: Exis JS is built on a highly optimized, zero-allocation Radix Tree. Any changes to the core request lifecycle must be rigorously benchmarked by the maintainers.
2. **Public API Signatures**: Do not introduce breaking changes to user-facing APIs (like `defineApp()`, `req`, `res`, or dependency injection).
3. **Version Numbers (`package.json`)**: Do not manually bump version numbers in the `package.json` files. Version bumps and releases are handled exclusively by the maintainers using git tags (e.g., `git tag v0.4.0 && git push --tags`).
4. **Generated Files**: Do not commit anything inside the `dist/`, `.exis/`, or `coverage/` directories. These are automatically generated during the build pipeline.

## Commit Message Guidelines

We enforce a strict, professional commit message format. A great commit message provides context for the reviewer and future maintainers. Every commit must clearly answer the **What**, **Why**, and **How** of the change.

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
2. Ensure your code passes all tests (`npm test`).
3. Write a concise summary of your changes in the PR description.
4. Push to your fork and submit a Pull Request.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md). We expect all contributors to follow these guidelines to ensure a welcoming environment for everyone.

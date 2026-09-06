<p align="center">
  <img src="https://raw.githubusercontent.com/v25group/exisjs/main/.github/assets/exisjs.png" height="200" alt="Exis JS Logo" />
  <h1 align="center">Exis JS Documentation</h1>
</p>

<p align="center">
  <b>Ultra-high-performance TypeScript web framework with a raw Rust engine under the hood.</b>
</p>

<p align="center">
  <a aria-label="NPM version" href="https://www.npmjs.com/package/exisjs">
    <img alt="" src="https://img.shields.io/npm/v/exisjs.svg?style=for-the-badge&labelColor=000000&color=000000">
  </a>
  <a aria-label="License" href="https://github.com/v25group/exisjs/blob/main/LICENSE">
    <img alt="" src="https://img.shields.io/npm/l/exisjs.svg?style=for-the-badge&labelColor=000000&color=000000">
  </a>
  <a aria-label="Join the community on GitHub" href="https://github.com/v25group/exisjs/discussions">
    <img alt="" src="https://img.shields.io/badge/Join%20the%20community-on%20GitHub-black.svg?style=for-the-badge&logo=github&labelColor=000000&color=000000&logoWidth=20">
  </a>
</p>

Welcome to the ExisJS documentation! ExisJS is a minimal, opinionated core framework featuring file-system routing, dependency injection, validation (`tex`), sanitization, and an auto-detected request pipeline (`boundary.ts`).

Additional capabilities (databases, auth, queues, websockets, caching) are provided as official `@exisjs/*` packages.

## Documentation Structure

- **[Content](./content/)**: Core concepts, guides, and deep-dives into building applications with ExisJS. Learn about folder-based routing, setting up your `boundary.ts`, dependency injection, and schema validation with `tex`.
- **[Reference](./reference/)**: API reference for the core framework modules (`router`, `di`, `validator`, `middleware`, `decorators`, `config`, etc.).
- **[Architecture](./ARCHITECTURE.md)**: Catalog of core features and internal architectural details.
- **[Benchmarks](./BENCHMARKS.md)**: Performance benchmarks against other Node.js frameworks.

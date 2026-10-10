# ExisJS Release Archive

This directory contains the detailed release notes for every version of ExisJS, grouped by minor series. The root [`CHANGELOG.md`](../CHANGELOG.md) holds the summary of each release.

## Directory Structure

```text
changelog/
├── README.md               # This navigation guide
├── v0.8/                   # 0.8.x Release Series
│   └── v0.8.0.md           # Pure TypeScript core (no native engine), performance & security hardening
└── v0.7/                   # 0.7.x Release Series
    ├── v0.7.14.md          # Windows CLI hardening, route specificity, res.download streams
    ├── v0.7.13.md          # Discriminated unions, schema composition, tex.coerce
    ├── v0.7.12.md          # Automatic database boot connection, exis run
    ├── v0.7.11.md          # Static route fast path, uWS parity, timingSafeEqual
    ├── v0.7.10.md          # Controller inheritance, forwardRef, @Global modules
    ├── v0.7.9.md           # Enterprise OOP decorators
    ├── v0.7.8.md           # Subpath export fixes
    ├── v0.7.7.md           # Swagger / OpenAPI 3.1
    ├── v0.7.6.md           # Response toolkit, error envelopes, tex.env
    ├── v0.7.5.md           # Resilience, DX standards & conventions
    ├── v0.7.4.md           # Validation, uploads, and timeouts
    ├── v0.7.3.md           # Compression, CLI tooling, realtime SSE
    ├── v0.7.2.md           # ESM relative specifiers and router DX
    ├── v0.7.1.md           # Complete OOP parity and logging overhaul
    └── v0.7.0.md           # Decouple core runtime, introduce boundaries
```

## Conventions

- One file per release: `v<major>.<minor>/v<version>.md`.
- Each file starts with the release date, type and affected packages, then Highlights, and where relevant **Breaking Changes**, Added, Fixed, Removed, and an Upgrade Guide.
- Notes from 0.7.x mention the `@exisjs/rs` native engine, which was removed in 0.8.0. They are kept unchanged as historical record.

## Quick Links

- [Latest Release (v0.8.0)](./v0.8/v0.8.0.md)
- [Root Changelog](../CHANGELOG.md)
- [Documentation](../docs/)

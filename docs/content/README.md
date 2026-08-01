# ExisJS Documentation Blueprint

This directory contains the core documentation for ExisJS. This `README.md` acts as a **blueprint** and index to help you navigate the features and understand what each markdown file contains.

## 🚀 Getting Started
*   **`introduction.mdx`**: High-level overview of ExisJS, its philosophy, and why it exists.
*   **`installation.mdx`**: How to create a new project using `create-exis` and basic setup.
*   **`structure.mdx`**: Explains the recommended folder structure (e.g., `src/http`, `src/jobs`, `src/services`).
*   **`cli.mdx`**: Documentation for the Exis CLI (`exis dev`, `exis build`), including Esbuild integration and Smart Port Detection.
*   **`config.mdx`**: How to configure the framework using `exis.config.ts`.

## 🧠 Core Routing & HTTP
*   **`routing.mdx`**: Covers File-System Routing, exact matches, parameters, and wildcards using the Radix Tree.
*   **`controllers.mdx`**: Using OOP class-based controllers (`@Controller`) and Functional controllers.
*   **`gateways.mdx`**: Explains Topological folder-based middleware (e.g., `_gateway.ts`) that runs before routes in a directory.
*   **`middleware.mdx`**: Global and route-level middleware, CORS, and `req.log` interception.
*   **`requests.mdx`**: How to read query params, body data, headers, and use the global `req` object.
*   **`responses.mdx`**: Sending JSON, streams, raw data, and manipulating HTTP status codes.

## 🏗️ Architecture & DI
*   **`modules.mdx`**: Grouping controllers and providers into modular chunks.
*   **`providers.mdx`**: Dependency Injection (DI) system, singletons, and injecting services.
*   **`decorators.mdx`**: Overview of all decorators available for OOP paradigms (e.g., `@Get`, `@Inject`).

## 🛡️ Data & Validation
*   **`validation.mdx`**: The Zod-like type-safe validation engine (`v`), strict parsing, and the standalone `sanitize` utilities.
*   **`dataloader.mdx`**: Solving the N+1 database problem automatically using integrated data loaders.
*   **`cache.mdx`**: Application-level caching, response caching, and invalidation strategies.

## ⚡ Advanced Capabilities
*   **`websockets.mdx`**: Real-time bidirectional communication using the native uWebSockets integration.
*   **`sse.mdx`**: Server-Sent Events for one-way streaming (useful for AI text generation).
*   **`queues.mdx`**: Background job processing, workers, and Redis-backed queues.
*   **`cron.mdx`**: Scheduling recurring tasks effortlessly using `cron` syntax.
*   **`rpc.mdx`**: End-to-end type safety connecting the ExisJS backend with an `@exisjs/client` frontend.

## 🔒 Security & Reliability
*   **`security.mdx`**: Helmet integration, Rate Limiting, CORS configuration, and best practices.
*   **`errors.mdx`**: Global error handling, custom `HttpException` classes, and safe error masking in production.
*   **`circuit-breaker.mdx`**: Preventing cascading failures when external APIs or databases go down.
*   **`testing.mdx`**: Using the integrated, native `node:test` runner to test your endpoints without Jest.

## 🔌 Ecosystem
*   **`adapters.mdx`**: How to run ExisJS inside serverless environments or mount it seamlessly alongside Next.js.

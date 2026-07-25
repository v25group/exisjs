<p align="center">
  <img src="./.github/assets/exisjs.png" height="200" alt="Exis JS Logo" />
  <h1 align="center">Exis JS</h1>
</p>

<p align="center">
  <b>Enterprise ambition with zero-config simplicity. The ultimate batteries-included Node.js backend.</b>
</p>

<p align="center">
  <a aria-label="NPM version" href="https://www.npmjs.com/package/exisjs">
    <img alt="" src="https://img.shields.io/npm/v/exisjs.svg?style=for-the-badge&labelColor=000000">
  </a>
  <a aria-label="CI Status" href="https://github.com/v25group/exisjs/actions">
    <img alt="" src="https://img.shields.io/github/actions/workflow/status/v25group/exisjs/ci.yml?style=for-the-badge&labelColor=000000">
  </a>
  <a aria-label="License" href="https://github.com/v25group/exisjs/blob/main/LICENSE">
    <img alt="" src="https://img.shields.io/npm/l/exisjs.svg?style=for-the-badge&labelColor=000000">
  </a>
</p>

---

## Description

Exis JS is the ultimate batteries-included backend framework for Node.js. It gives you the performance of a minimal micro-framework and the end-to-end type safety of an RPC client—without spending weeks plumbing different tools together. Built from the ground up with strict TypeScript, it combines the structural brilliance of file-system routing with powerful dependency injection.

Under the hood, Exis JS utilizes a highly optimized zero-allocation HTTP engine that natively rivals and even edges out Fastify in benchmark performance, while providing out-of-the-box compatibility with powerful middlewares, security headers, and robust logging systems.

## Philosophy

In recent years, JavaScript has become the "lingua franca" of the web. While frontend frameworks have established incredibly productive, file-system based architectures, the Node.js backend ecosystem has largely remained fragmented. While there are many superb libraries (like Express), they don't inherently solve the main problem — architecture and developer experience.

Exis JS aims to provide an application architecture out of the box which allows for the effortless creation of highly performant, flawlessly structured, and easily maintainable APIs. By enforcing intuitive file-system routing and strict typing, Exis JS eliminates boilerplate and configuration fatigue.

## Architecture (Monorepo)

The Exis JS framework is meticulously organized as a monorepo containing three purpose-built packages:

1. 📦 **`exisjs`** - The core backend engine. It handles high-performance HTTP routing, WebSockets, Redis queues, and more. Installed on your server.
2. 📦 **`@exisjs/client`** - The 0-dependency frontend proxy client. It provides magical end-to-end type safety for your React, Next.js, or Vite apps, without importing any backend Node.js code. Installed on your frontend.
3. 📦 **`@exisjs/create`** - The interactive CLI tool to instantly scaffold production-ready Exis JS projects. Run globally via `npx`.

## Getting started

The absolute fastest way to get started with Exis JS is by using our interactive CLI tool. It will scaffold a fully configured, production-ready project in seconds:

```bash
npx @exisjs/create@latest my-backend
cd my-backend
npm run dev
```

Your hot-reloading development server is now running!

## Questions

For questions and support, please reach out to the core team or join our community discussions. The issue list of this repository is exclusively for bug reports and feature requests.

## Issues

Please make sure to read the [Contribution Guidelines](./CONTRIBUTING.md) before opening an issue. Issues not conforming to the guidelines or missing reproduction steps may be closed immediately. We also curate a list of **Good First Issues** specifically designed for developers looking to make their first impact.

## Consulting

We take performance and security with the utmost seriousness. If you need expert help straight from the Exis JS core team—including architecture reviews, migration strategies, or team augmentation—please reach out to us directly.

For security vulnerabilities, please do **NOT** open a public issue. Reach out to the core team directly so we can swiftly and safely address it.

---

<p align="center">
  <i>Engineered with absolute precision by the Exis JS Team.</i>
</p>

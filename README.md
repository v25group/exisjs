<p align="center">
  <img src="./.github/assets/exisjs.png" height="200" alt="Exis JS Logo" />
  <h1 align="center">Exis JS</h1>
</p>

<p align="center">
  <b>A cohesive, full-stack framework for Node.js offering enterprise structure with a seamless developer experience.</b>
</p>

<p align="center">
  <a aria-label="NPM version" href="https://www.npmjs.com/package/exisjs">
    <img alt="" src="https://img.shields.io/npm/v/exisjs.svg?style=for-the-badge&labelColor=000000">
  </a>
  <a aria-label="License" href="https://github.com/v25group/exisjs/blob/main/LICENSE">
    <img alt="" src="https://img.shields.io/npm/l/exisjs.svg?style=for-the-badge&labelColor=000000&color=000000">
  </a>
  <a aria-label="Join the community on GitHub" href="https://github.com/v25group/exisjs/discussions">
    <img alt="" src="https://img.shields.io/badge/Join%20the%20community-on%20GitHub-black.svg?style=for-the-badge&logo=github&labelColor=000000&color=000000&logoWidth=20">
  </a>
</p>

---

## ⚡ What is ExisJS?

**A unified approach to building web applications.**
ExisJS provides a comprehensive foundation for Node.js backends. It integrates the intuitive developer experience of file-system routing with the robust organizational patterns needed for large-scale applications all supported by a deeply integrated native core.

If you appreciate the straightforward nature of traditional frameworks but require built-in TypeScript support, dependency injection, automatic OpenAPI documentation, and end-to-end type safety, ExisJS provides those out of the box.

---

## 🚀 Quickstart

Start a fully-configured, production-ready backend project:

```bash
npm create @exisjs@latest my-backend
cd my-backend
npm run dev
```

### Dual-Paradigm Routing

While ExisJS provides a clear, structured foundation for your project's layout, it gives you complete freedom in how you write your route logic. You can choose the programming paradigm that best fits your needs: write focused, functional routes or utilize structured, class-based controllers. Both paradigms seamlessly hook into the core validation and OpenAPI generation engines.

<details open>
<summary><b>Option A: Functional Routing</b></summary>

```typescript
import { controller, route } from 'exisjs/router'
import { tex } from 'exisjs/validator'

const UserSchema = tex.object({ id: tex.number(), name: tex.string() })

export default controller({
  // Safely typed, automatically validated, and added to Swagger!
  createUser: route.post('/', {
    body: UserSchema,
    returns: UserSchema,
    handle: async ({ body }) => {
      return { id: Date.now(), name: body.name }
    },
  }),
})
```

</details>

<details>
<summary><b>Option B: Class-Based (OOP) Controllers</b></summary>

```typescript
import { Controller, Post, Body, Returns } from 'exisjs/decorators'
import { tex } from 'exisjs/validator'

const UserSchema = tex.object({ id: tex.number(), name: tex.string() })

@Controller()
export default class UserController {
  @Post('/')
  @Returns(UserSchema)
  async createUser(@Body() body: typeof UserSchema) {
    // 1. Automatically validated against UserSchema
    // 2. Safely typed as { id: number, name: string }
    // 3. Automatically mapped into your Swagger /docs/json!
    return { id: Date.now(), name: body.name }
  }
}
```

</details>

---

## 🛠️ The Philosophy

The Node.js ecosystem often requires developers to stitch together many disparate libraries.

- Minimalist frameworks require you to manually install and configure routers, validation libraries, DI containers, and OpenAPI generators.
- Enterprise frameworks offer strong structure, but often introduce heavy boilerplate and complex abstractions.

**ExisJS offers a cohesive alternative.**

1. **File-System Routing**: Drop a `route.ts` file in `src/http/users/` to establish a `/users` endpoint.
2. **Auto-Generated Documentation**: Every `@Body`, `@Query`, and `@Returns` decorator automatically builds your interactive OpenAPI docs. No duplicate schema definitions required.
3. **End-to-End Type Safety**: The `@exisjs/fetch` package provides your frontend applications (like React or Vue) with seamless auto-completion of your backend routes and payloads, directly from your route definitions.
4. **Efficient Architecture**: Built on top of a native Rust core (`@exisjs/rs`), ExisJS handles complex parsing and routing efficiently, allowing your business logic to scale reliably.

---

## 🧪 Example Projects

We maintain practical reference applications directly in our repository to demonstrate recommended patterns:

- [**01-my-app**](./examples/01-my-app): A minimal starter demonstrating file-system routing.
- [**02-bookstore**](./examples/02-bookstore): A structured API showcasing nested routes, error boundaries, and dependency injection.
- [**03-chat**](./examples/03-chat): Real-time communication using built-in WebSockets.
- [**04-ai-chat**](./examples/04-ai-chat): Streaming responses and external integrations.
- [**05-all-features**](./examples/05-all-features): A comprehensive application demonstrating cron jobs, background queues, database adapters, and more.

---

## 🏗️ Monorepo Structure

The ExisJS framework is organized as a monorepo containing carefully scoped packages:

1. 📦 **`exisjs`** - The primary backend framework handling HTTP routing, WebSockets, background tasks, and Swagger.
2. 📦 **`@exisjs/fetch`** - The integrated HTTP client to connect your frontend to your API with absolute type safety.
3. 📦 **`@exisjs/create`** - The CLI tool to scaffold structured ExisJS projects.
4. 📦 **`@exisjs/rs`** - The native Rust engine powering routing and validation under the hood.

---

## 🤝 Contributing

ExisJS is currently in **Beta**. We welcome developers to explore the framework, experiment with its features, and provide feedback on the developer experience.

Please review our [Contribution Guidelines](./CONTRIBUTING.md) before submitting a pull request. We curate a list of **Good First Issues** designed specifically for new contributors.

<p align="center">
  <i>Developed with care by the Exis JS Team.</i>
</p>

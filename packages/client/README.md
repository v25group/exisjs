<p align="center">
  <img src="https://raw.githubusercontent.com/v25group/exisjs/main/.github/assets/exisjs.png" height="200" alt="Exis JS Logo" />
  <h1 align="center">@exisjs/client</h1>
</p>

<p align="center">
  <b>The 0-dependency, end-to-end type-safe RPC client for Exis JS.</b>
</p>

<p align="center">
  <a aria-label="NPM version" href="https://www.npmjs.com/package/@exisjs/client">
    <img alt="" src="https://img.shields.io/npm/v/@exisjs/client.svg?style=for-the-badge&labelColor=000000">
  </a>
</p>

---

## Description

`@exisjs/client` is the official frontend proxy client for the [Exis JS Framework](https://github.com/v25group/exisjs). 

It is designed to give you **magical, end-to-end type safety** in your frontend applications (React, Next.js, Vite, React Native) without bundling a single line of backend Node.js code.

Under the hood, it is an extremely thin, sub-1kb wrapper over the native browser `fetch` API. It dynamically translates object paths (like `api.users.get()`) into fully formed HTTP requests, complete with TypeScript autocompletion for your exact backend routing structure, query parameters, and JSON body payloads.

## Installation

```bash
npm install @exisjs/client
```

## Quick Start

### 1. Export your Router Type (Backend)
First, export the type of your Exis JS router from your backend:
```typescript
// backend/src/http/server.ts
import { defineApp } from 'exisjs'

const app = defineApp()
// ... define routes ...

export type AppRouter = typeof app.router 
```

### 2. Initialize the Client (Frontend)
Use a **Type-Only Import** to bring your router signature into your frontend, and initialize the client:
```typescript
// frontend/src/api.ts
import { createClient } from '@exisjs/client'
import type { AppRouter } from '../../backend/src/http/server'

export const api = createClient<AppRouter>({
  baseUrl: 'http://localhost:4000'
})
```

### 3. Fetch with 100% Autocomplete!
```typescript
// 100% Type-Safe! Your IDE knows exactly what URL this calls and what data it returns.
const users = await api.api.v1.users.get()

// Your IDE knows exactly what fields are required in the body payload!
const newPost = await api.api.v1.posts.post({
  title: 'Hello from the frontend!'
})
```

## Advanced Features

### Robust Error Handling (`ExisClientError`)
If the server returns a non-200 status code (like `400 Bad Request`), the client automatically intercepts it and throws a structured `ExisClientError`. This allows your `try/catch` blocks or React Query handlers to work flawlessly.

```typescript
import { ExisClientError } from '@exisjs/client'

try {
  await api.users.get()
} catch (error) {
  if (error instanceof ExisClientError) {
    console.log(error.status) // e.g., 401
    console.log(error.data)   // Parsed JSON error payload from the server
  }
}
```

### Lifecycle Interceptors
You can define global hooks for intercepting requests and responses—perfect for injecting auth headers, logging, or handling token refreshes.

```typescript
const api = createClient<AppRouter>({
  baseUrl: 'http://localhost:4000',
  onRequest: async (req, url) => {
    // Inject Authorization header dynamically
    req.headers.set('Authorization', `Bearer ${localStorage.getItem('token')}`)
  },
  onResponse: async (res, url) => {
    if (res.status === 401) {
      console.error('Session expired!')
    }
  }
})
```

### Custom Fetch Injection
Building for React Native or a specialized edge environment? You can completely override the internal `fetch` function:

```typescript
const api = createClient<AppRouter>({
  baseUrl: 'https://api.myapp.com',
  fetch: customFetchFunction // Inject your own fetch!
})
```

## Documentation

For full documentation and API references, please visit the main [Exis JS Repository](https://github.com/v25group/exisjs).

---

<p align="center">
  <i>Engineered with absolute precision by the Exis JS Team.</i>
</p>

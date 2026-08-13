<p align="center">
  <img src="https://raw.githubusercontent.com/v25group/exisjs/main/.github/assets/exisjs.png" height="200" alt="Exis JS Logo" />
  <h1 align="center">@exisjs/fetch</h1>
</p>

<p align="center">
  <b>A zero-dependency, fully-typed HTTP and RPC client for Exis JS.</b>
</p>

<p align="center">
  <a aria-label="NPM version" href="https://www.npmjs.com/package/@exisjs/fetch">
    <img alt="" src="https://img.shields.io/npm/v/@exisjs/fetch.svg?style=for-the-badge&color=000000&labelColor=000000">
  </a>
  <a aria-label="License" href="https://github.com/v25group/exisjs/blob/main/LICENSE">
    <img alt="" src="https://img.shields.io/npm/l/@exisjs/fetch.svg?style=for-the-badge&color=000000&labelColor=000000">
  </a>
  <a aria-label="Join the community on GitHub" href="https://github.com/v25group/exisjs/discussions">
    <img alt="" src="https://img.shields.io/badge/Join%20the%20community-on%20GitHub-000000.svg?style=for-the-badge&logo=github&labelColor=000000&logoWidth=20">
  </a>
</p>

---

## Description

`@exisjs/fetch` is the official HTTP client for Exis JS. Built entirely on the native `fetch` API, it is a zero-dependency, extremely lightweight client that acts as a 100% drop-in replacement for axios, with the added benefit of a highly-typed RPC Proxy for your Exis backend!

- **0 dependencies.** Supply-chain safe.
- **100% axios-compatible API.** Interceptors, error handling, config.
- **Built-in Retries.** Exponential back-off out of the box.
- **Response Caching.** In-memory caching for `GET` and `HEAD` requests.
- **Request De-duplication.** Prevent duplicate in-flight network requests.
- **TypeScript First.** Full generics and built-in typings.
- **RPC Proxy.** Seamlessly consume your Exis `AppRouter` with full end-to-end type safety!

---

## 1. Typed RPC Client

If you are using Exis JS on your backend, you can create a fully-typed RPC client that mirrors your backend routing perfectly.

```ts
import { createClient } from "@exisjs/fetch";
import type { AppRouter } from "../backend/.exis/types";

const api = createClient<AppRouter>({
  baseUrl: "http://localhost:3000",
  headers: () => {
    return {
      Authorization: `Bearer ${localStorage.getItem("token")}`
    };
  }
});

// Fully typed! Autocomplete will show all available routes and their inputs.
const user = await api.users.get({ id: 123 });
```

### HTML Error Overlays

In development mode, if the Exis server throws a `500` error and returns a `text/html` stack trace, `@exisjs/fetch` will automatically intercept it and display a beautiful full-screen iframe overlay, allowing you to instantly debug without opening the network tab.

---

## 2. Standard HTTP Client

You can use the default instance just like `axios` or native `fetch`.

```ts
import http from "@exisjs/fetch";

// GET
const { data } = await http.get("https://api.example.com/users");

// POST
const { data } = await http.post("https://api.example.com/users", {
  name: "Alice",
});
```

You can also create isolated instances:

```ts
import { fetch as http } from "@exisjs/fetch";

const api = http.create({
  baseURL: "https://api.example.com/v1",
  timeout: 10_000,
});
```

---

## 3. Retries (Built-in)

Automatic retry with exponential back-off is built directly into `@exisjs/fetch`.

```ts
const api = http.create({
  retries: 3, // up to 3 extra attempts
  retryDelay: 500, // base delay in ms (doubles each attempt)
  retryOn: [408, 429, 500, 502, 503, 504], // which statuses retry
});
```

---

## 4. Response Caching

You can optionally cache `GET` and `HEAD` responses in-memory.

```ts
// Cache this GET for the default 60s
await http.get("/config", { cache: true });

// Custom TTL
await http.get("/config", { cache: { ttl: 5 * 60_000 } });

// Inspect / clear
http.cache.size;
http.cache.clear();
```

---

## 5. Request De-duplication

Prevent multiple identical network requests from firing simultaneously.

```ts
// If five components call this at once, only one network request fires!
await Promise.all([
  http.get("/me", { dedupe: true }),
  http.get("/me", { dedupe: true }),
  http.get("/me", { dedupe: true }),
]);
```

---

## 6. Interceptors

Interceptors are identical to the standard axios API.

```ts
// Request Interceptor
http.interceptors.request.use((config) => {
  config.headers["Authorization"] = "Bearer token";
  return config;
});

// Response Interceptor
http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized
    }
    return Promise.reject(error);
  }
);
```

---

## 7. Mock Adapter for Tests

Easily mock out endpoints in your test environment without spinning up a server.

```ts
import { createMockAdapter } from "@exisjs/fetch";

const api = http.create({
  adapter: createMockAdapter([
    {
      method: "GET",
      url: "/users/1",
      response: () => ({ id: 1, name: "Alice" }),
    },
  ]),
});

const { data } = await api.get("/users/1"); // { id: 1, name: 'Alice' }, no network call!
```

---

## 8. Cancellation

Cancel requests using standard `AbortController` (or legacy `CancelToken`).

```ts
const controller = new AbortController();

setTimeout(() => controller.abort(), 3000);

try {
  await http.get("/slow-endpoint", { signal: controller.signal });
} catch (err) {
  if (http.isCancel(err)) {
    console.log("Request cancelled!");
  }
}
```

---

## 9. Request Aliases

`@exisjs/fetch` provides a set of aliases for making HTTP requests. These aliases are shortcuts for making requests using the core request method, designed to be consistent with the HTTP methods defined in RFC 7231 and RFC 5789.

```ts
import http from "@exisjs/fetch";

// The core request method
http.request<T, R, D>(config: FetchRequestConfig<D>);

// Standard HTTP method aliases
http.get<T, R, D>(url: string, config?: FetchRequestConfig<D>);
http.delete<T, R, D>(url: string, config?: FetchRequestConfig<D>);
http.head<T, R, D>(url: string, config?: FetchRequestConfig<D>);
http.options<T, R, D>(url: string, config?: FetchRequestConfig<D>);
http.post<T, R, D>(url: string, data?: D, config?: FetchRequestConfig<D>);
http.put<T, R, D>(url: string, data?: D, config?: FetchRequestConfig<D>);
http.patch<T, R, D>(url: string, data?: D, config?: FetchRequestConfig<D>);

// The new HTTP QUERY method (RFC 10008)
// Safe and idempotent, but allows carrying a complex request body.
http.query<T, R, D>(url: string, data?: D, config?: FetchRequestConfig<D>);
```

### URL Builder

The `getUri` method returns the URL that would be sent for a given config without actually making the request. It applies `baseURL`, `paramsSerializer`, and `params`.

```ts
const url = http.getUri({ 
  url: "/users", 
  baseURL: "https://api.example.com", 
  params: { active: true, role: "admin" }
}); 
// "https://api.example.com/users?active=true&role=admin"
```

### Form data shorthand methods

These methods are equivalent to their counterparts above, but preset `Content-Type` to `multipart/form-data`. They are the recommended way to upload files or submit HTML forms.

```ts
http.postForm<T, R, D>(url: string, data?: D, config?: FetchRequestConfig<D>);
http.putForm<T, R, D>(url: string, data?: D, config?: FetchRequestConfig<D>);
http.patchForm<T, R, D>(url: string, data?: D, config?: FetchRequestConfig<D>);
```

---

## Documentation

For full documentation and guides on building with Exis JS, please visit the main [Exis JS Repository](https://github.com/v25group/exisjs).

---

<p align="center">
  <i>Engineered with absolute precision by the Exis JS Team.</i>
</p>

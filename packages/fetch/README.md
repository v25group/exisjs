# @exisjs/fetch

[![npm @exisjs/fetch package](https://img.shields.io/npm/v/@exisjs/fetch.svg)](https://npmjs.org/package/@exisjs/fetch)
[![npm license](https://img.shields.io/npm/l/@exisjs/fetch.svg)](https://github.com/v25group/exisjs/blob/main/LICENSE)

`@exisjs/fetch` is a lightweight, zero-dependency HTTP and typed RPC client for ExisJS applications and web frontends.

---

## Installation

```bash
npm install @exisjs/fetch
```

---

## Features

- **Zero External Dependencies**: Built entirely on the standard web `fetch` API.
- **Typed RPC Client**: Direct type-safe invocation of backend routes and payloads using exported `AppRouter` types.
- **Axios-Compatible API**: Support for request/response interceptors, cancellation (`AbortController`), and custom headers.
- **Automatic Retry & Cache**: Built-in exponential backoff retries and in-memory response caching for idempotent requests.
- **RFC 10008 QUERY Method**: Support for `http.query()` with complex JSON payloads.

---

## Usage

### 1. Typed RPC Client

Consume your ExisJS backend API with complete end-to-end type safety:

```typescript
import { createClient } from '@exisjs/fetch'
import type { AppRouter } from '../backend/.exis/types'

const api = createClient<AppRouter>({
  baseUrl: 'http://localhost:3000',
  headers: () => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  }),
})

// Autocompleted route path with inferred response type
const response = await api.users.get()
console.log(response.data)
```

### 2. Standard HTTP Client

Use the client directly as an HTTP request utility:

```typescript
import http from '@exisjs/fetch'

// GET request
const { data } = await http.get<{ id: string; name: string }>('/api/users/1', {
  baseURL: 'https://api.example.com',
})

// POST request with JSON body
const result = await http.post('/api/users', { name: 'Alice' }, {
  baseURL: 'https://api.example.com',
})
```

### 3. Request Interceptors

```typescript
import http from '@exisjs/fetch'

http.interceptors.request.use((config) => {
  config.headers = {
    ...config.headers,
    'X-Client-Version': '1.0.0',
  }
  return config
})
```

---

## API Reference

### HTTP Methods

```typescript
http.get<T>(url, config?)
http.post<T>(url, data?, config?)
http.put<T>(url, data?, config?)
http.patch<T>(url, data?, config?)
http.delete<T>(url, config?)
http.head<T>(url, config?)
http.options<T>(url, config?)
http.query<T>(url, data?, config?)
http.postForm<T>(url, formData, config?)
```

---

## Documentation

For full documentation and integration guides, visit the [ExisJS Repository](https://github.com/v25group/exisjs) and [exisjs.com](https://exisjs.com).

---

## License

[MIT License](https://github.com/v25group/exisjs/blob/main/LICENSE)

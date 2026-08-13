<p align="center">
  <img src="https://raw.githubusercontent.com/v25group/exisjs/main/.github/assets/exisjs.png" height="200" alt="Exis JS Logo" />
  <h1 align="center">@exisjs/telemetry</h1>
</p>

<p align="center">
  <b>Zero-Config OpenTelemetry integration for the Exis JS Framework.</b>
</p>

<p align="center">
  <a aria-label="NPM version" href="https://www.npmjs.com/package/@exisjs/telemetry">
    <img alt="" src="https://img.shields.io/npm/v/@exisjs/telemetry.svg?style=for-the-badge&color=000000&labelColor=000000">
  </a>
  <a aria-label="License" href="https://github.com/v25group/exisjs/blob/main/LICENSE">
    <img alt="" src="https://img.shields.io/npm/l/@exisjs/telemetry.svg?style=for-the-badge&color=000000&labelColor=000000">
  </a>
  <a aria-label="Join the community on GitHub" href="https://github.com/v25group/exisjs/discussions">
    <img alt="" src="https://img.shields.io/badge/Join%20the%20community-on%20GitHub-000000.svg?style=for-the-badge&logo=github&labelColor=000000&logoWidth=20">
  </a>
</p>

---

## Description

`@exisjs/telemetry` is the official observability and tracing package for the [Exis JS Framework](https://github.com/v25group/exisjs).

It abstracts away all the complex boilerplate required to configure `@opentelemetry/sdk-node`, `auto-instrumentations-node`, and `OTLP` exporters. When enabled, it dynamically bootstraps itself *before* your ExisJS server binds, automatically instrumenting incoming HTTP requests, Mongoose queries, and Redis calls.

## Installation

```bash
npm install @exisjs/telemetry
```

## Quick Start

### 1. Enable Telemetry in your Config

Simply set `telemetry: { enabled: true }` in your `exis.config.ts`. The ExisJS server will automatically detect the package and boot it!

```typescript
// exis.config.ts
import { defineConfig } from 'exisjs/config'

export default defineConfig({
  telemetry: {
    enabled: true,
    serviceName: 'my-microservice',
    exporter: process.env.NODE_ENV === 'production' ? 'otlp' : 'console',
    endpoint: 'http://localhost:4318/v1/traces' // Default OTLP endpoint
  }
})
```

### 2. Auto-Instrumentation

That's it! By default, the package will use `getNodeAutoInstrumentations()` to capture all incoming API requests and background processes. 

If `exporter` is set to `'console'`, traces will print directly to your terminal (great for local development!). If set to `'otlp'`, traces will be sent to your telemetry backend (like Datadog, Jaeger, or Grafana Tempo).

## Advanced Usage

You can use the exported tools from this package to manually add metadata or track specific logic within your route handlers:

```typescript
import { getActiveSpan } from '@exisjs/telemetry'

app.get('/api/users/:id', async (req, res) => {
  // Grab the auto-created span for this HTTP request
  const span = getActiveSpan()
  
  // Attach custom business attributes
  span?.setAttribute('user.id', req.params.id)
  
  // Log a specific timeline event
  span?.addEvent('Processing User Request')

  res.json({ success: true })
})
```

## Documentation

For full documentation and API references, please visit the main [Exis JS Repository](https://github.com/v25group/exisjs).

---

<p align="center">
  <i>Engineered with absolute precision by the Exis JS Team.</i>
</p>

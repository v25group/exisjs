# Benchmark Results

### System Information
- **OS:** win32 (x64)
- **CPU:** 11th Gen Intel(R) Core(TM) i5-11400H @ 2.70GHz (12 cores)
- **RAM:** 16 GB
- **Node:** v26.3.0

### Test Configuration
- **Tool:** autocannon ^8.0.0
- **Connections:** 100, **Duration:** 10s, **Pipelining:** 1 (no pipelining)
- **Trials:** 3 per framework, order randomized each trial, median reported
- **Warmup:** 2s untimed warmup run before each timed trial
- **Cores:** single-core, no clustering, for all four frameworks
- **Framework versions:** Express ^5.2.1, Fastify ^5.10.0, Hono ^4.12.32, ExisJS 0.4.0

### Performance Metrics

| Framework | Req/Sec (median) | Latency avg (ms) | Latency p50 (ms) | Latency p99 (ms) | Errors | Server backend |
|---|---|---|---|---|---|---|
| Express | 22048.73 | 4.10 | 4.00 | 6.00 | 0 | n/a |
| Fastify | 37839.28 | 2.21 | 2.00 | 5.00 | 0 | n/a |
| Hono | 33572.00 | 2.40 | 2.00 | 4.00 | 0 | n/a |
| Exis JS | 31475.64 | 2.67 | 3.00 | 5.00 | 0 | n/a |

### Handler Parity Note

ExisJS's handler in this benchmark declares a `response` JSON schema, which the framework uses to validate and serialize the response. Express, Fastify, and Hono's handlers here do not declare an equivalent schema. This makes ExisJS's numbers more notable if it still leads, since it's doing strictly more work per request — but it means this is not a pure routing-only comparison. A schema-stripped variant should be run separately if a fully symmetric comparison is needed.

### Understanding the Results

You may notice that in our microbenchmarks (routing only), ExisJS's Radix Tree performs route lookups in ~3ns compared to Fastify's ~130ns (a ~40x difference). However, in the full HTTP throughput benchmark above, the gap narrows substantially.

**Why?** Route lookup is only a microscopic fraction of a full HTTP request lifecycle. The vast majority of time is spent on Node.js I/O, socket management, header parsing, and JSON serialization. While our router is objectively faster in isolation, overall framework throughput is bounded by the same underlying Node.js stream primitives every framework here is built on.

> *Note: These benchmarks were run locally on Windows, single-core, no clustering. For production-representative numbers, they should be reproduced on isolated Linux server instances with clustering configuration matching your actual deployment.*

# Benchmark Results

### System Information
- **OS:** win32 (x64)
- **CPU:** 11th Gen Intel(R) Core(TM) i5-11400H @ 2.70GHz (12 cores)
- **RAM:** 16 GB

### Performance Metrics

| Framework | Req/Sec (avg) | Latency (ms avg) | Errors |
|---|---|---|---|
| Express | 23544.00 | 3.72 | 0 |
| Fastify | 41153.46 | 2.07 | 0 |
| Hono | 39162.91 | 2.08 | 0 |
| Exis JS | 46441.60 | 1.77 | 0 |

### Understanding the Results

You may notice that in our microbenchmarks (routing only), ExisJS's Radix Tree performs route lookups in ~3ns compared to Fastify's ~130ns (a ~40x difference). However, in the full HTTP throughput benchmark above, ExisJS and Fastify perform within 1-2% of each other.

**Why?** Route lookup is only a microscopic fraction of a full HTTP request lifecycle. The vast majority of time is spent on Node.js I/O, socket management, header parsing, and JSON serialization. While our router is objectively faster, the overall framework performance is tied closely with Fastify because both frameworks are heavily optimizing the exact same underlying Node.js stream primitives.

> *Note: These benchmarks were run locally. For absolute production accuracy, they should be reproduced on isolated Linux server instances.*

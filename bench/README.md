# ExisJS Benchmarks

This folder measures ExisJS against plain `node:http`, Fastify, Hono and Express, and helps find where time goes inside ExisJS.

| Command | What it does | Typical time |
| :--- | :--- | :--- |
| `npm run bench` | Full HTTP benchmark: every target and scenario, 3 rounds | ~45 min |
| `npm run bench:quick` | Same, 1 round with short runs (sanity check) | ~3 min |
| `npm run bench -- --write` | Full run, then regenerates [`docs/BENCHMARKS.md`](../docs/BENCHMARKS.md) | ~45 min |
| `npm run bench:router` | Route lookup micro-benchmark vs find-my-way and Hono | ~1 min |
| `npm run bench:validation` | `tex` vs Ajv micro-benchmark | ~1 min |
| `npm run bench:profile` | CPU profile of one server under load, with a hotspot summary | ~1 min |

`bench`, `bench:quick` and `bench:profile` build `packages/exisjs` first. Every script refuses to run against a missing or out-of-date `dist`, so results always reflect the code users install.

## Layout

```text
bench/
├── http.ts            # HTTP benchmark runner (autocannon)
├── profile.ts         # V8 CPU / heap profiling under load
├── micro/
│   ├── router.ts      # route lookup (mitata)
│   └── validation.ts  # body validation (mitata)
├── lib/
│   ├── harness.ts     # start/stop servers, IPC usage sampling, build check
│   └── scenarios.ts   # request scenarios + expected responses
├── servers/           # one file per framework, identical routes and payloads
├── results/           # raw JSON from each run (git-ignored)
└── .profiles/         # .cpuprofile / .heapprofile files (git-ignored)
```

## Scenarios

Every server implements the same four routes and must return the same response:

| Id | Request | Exercises |
| :--- | :--- | :--- |
| `json` | `GET /json` → `{"message":"Hello, World!"}` | Routing + serialization floor (TechEmpower "JSON" test) |
| `params` | `GET /users/12345?fields=name` | Path params and query parsing |
| `echo` | `POST /echo` with a small nested JSON body | Body read, `JSON` parse and serialize |
| `validate` | `POST /users` with `{ name, email, age }` | Body validation in each framework's idiom |

Validation is idiomatic per framework: `tex` for ExisJS, a JSON schema compiled by Ajv for Fastify, and the same hand-written check for `node:http`, Hono and Express (neither ships a validator). The report states this next to the results.

## Methodology

These follow common practice for HTTP framework benchmarks (fastify/benchmarks, TechEmpower):

1. **One process per server.** Every target runs single-process with logging, helmet and CORS off, so frameworks are compared with equal features.
2. **Correctness first.** Before measuring, the runner sends each scenario once and checks status and body. A server that answers wrongly is not measured.
3. **Warmup.** Each scenario gets an untimed warmup run (default 3 s) so V8 has optimized the hot paths before measurement starts.
4. **Fixed-duration load.** autocannon with 100 connections, no pipelining, 10 s per run. Pipelining is off by default because real HTTP/1.1 clients rarely use it; add `--pipelining 10` to compare raw framework overhead.
5. **Interleaved rounds.** Targets run in a new random order each round, and the median across rounds is reported. This spreads thermal throttling and background noise across all targets instead of penalizing whichever ran last.
6. **Server-side CPU time.** Over IPC, the runner reads the server's own `process.cpuUsage()` before and after each run and reports **CPU µs per request**. Unlike req/s, this barely moves when the load generator or the OS competes for cores, so it is the most reliable column for comparing frameworks on a laptop.
7. **Client saturation check.** If autocannon itself used over 90% of a core, the runner warns that req/s may be client-limited.
8. **Exact versions recorded.** Reports list the installed versions from `node_modules`, not the semver ranges in `package.json`.

### Getting publishable numbers

Laptop results drift by ±10–20% between runs (thermal limits, power plans, background apps). For numbers you publish:

- Use a dedicated Linux machine, with the load generator on a **second machine** on the same network.
- Pin the server to fixed cores (`taskset -c 2 node ...`) and disable CPU frequency scaling (`cpupower frequency-set -g performance`).
- Run the full benchmark (`npm run bench -- --write`) and report the same run for every framework.
- Never compare numbers from different machines or different days.

## Options

```bash
npm run bench -- --targets exis-node,exis-uws,fastify      # subset of targets
npm run bench -- --scenarios json,validate                 # subset of scenarios
npm run bench -- --rounds 5 --duration 20 --warmup 5       # longer, steadier runs
npm run bench -- --connections 256 --pipelining 10         # heavier load
npm run bench -- --workers 2                               # multi-threaded load generator
```

Targets: `raw-node`, `exis-node`, `exis-uws`, `fastify`, `hono`, `express`.

## Micro-benchmarks

`bench:router` and `bench:validation` use [mitata](https://github.com/evanwashere/mitata). Every result passes through `do_not_optimize()` so V8 cannot delete a call whose result is unused, a classic source of impossible "3 ns" numbers. The router table holds 1,000 static routes plus the routes under test, and covers static, param, wildcard and miss (404) lookups.

Micro-benchmarks show the cost of one component in isolation. They answer "is this function fast?" but not "is the server fast?", because routing or validation is only a small slice of a full request. Use them to check an optimization, and the HTTP benchmark to judge its real effect.

## Profiling

```bash
npm run bench:profile                                    # exis-node, all scenarios
npm run bench:profile -- --target exis-node --scenario echo --duration 15
npm run bench:profile -- --heap                          # allocation sampling
```

The profiler starts the server under V8's sampling profiler (`--cpu-prof`, 250 µs interval), drives load, shuts the server down cleanly so the profile is written, and prints:

- **Busy time by origin**: `exisjs`, `node core`, `dependencies`, and `native / V8`. Socket writes (`writev`) and GC fall under native; a large native share is normal for HTTP servers.
- **Top functions by self time**, with file and line in the compiled `dist`.

For flame graphs, open the `.cpuprofile` from `bench/.profiles/` in Chrome DevTools (Performance tab → *Load profile*) or drag it onto [speedscope.app](https://www.speedscope.app). Heap profiles open in the DevTools Memory tab.

A typical optimization loop:

1. `npm run bench:profile -- --scenario <slow one>` and find the top `exisjs` frames.
2. Change the code, then confirm with a micro-benchmark if the hotspot is isolated.
3. `npm run bench -- --targets raw-node,exis-node --scenarios <id> --rounds 5` and compare **Server CPU / req** before and after.

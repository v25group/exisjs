# exisjs

## 0.2.0

### Minor Changes

- 9874529: ### Adapters: Fix cold-start initialization & rename for cleaner API

  **Bug Fix — Serverless Cold-Start Initialization**

  All serverless and edge adapters now properly call `app.create()` and `app.onStartHook()` on the first incoming request (cold start). Previously, adapters skipped the application bootstrap phase entirely, meaning routes, plugins, and lifecycle hooks were never mounted in serverless environments. This caused 404/500 errors on every request when deployed to Vercel, AWS Lambda, Cloudflare Workers, and other platforms.

  Affected adapters: `vercel`, `aws`, `cloudflare`, `netlify`, `deno`, `bun`, `fastly`

  The core `app.fetch()` method also now includes this lazy initialization guard, ensuring any future custom adapters built on top of the Fetch API automatically inherit this fix.

  **Breaking Change — Adapter Rename**

  All adapter exports have been renamed from `serverless*` to shorter, cleaner names:

  - `serverlessVercel` → `vercel`
  - `serverlessAws` → `aws`
  - `serverlessCloudflare` → `cloudflare`
  - `serverlessNetlify` → `netlify`
  - `serverlessDeno` → `deno`
  - `serverlessBun` → `bun`
  - `serverlessFastly` → `fastly`

  **Migration:** Update your imports:

  ```diff
  - import { serverlessVercel } from 'exisjs/adapters'
  + import { vercel } from 'exisjs/adapters'
  ```

  **Documentation:** Adapters documentation has been fully rewritten with detailed guides for every platform, including a new section on the Fetch adapter and building custom adapters.

## 0.1.10

### Patch Changes

- 87e2dd3: - Fix bug where `autoMountJobs` searched `.ts` files instead of compiled `.js` jobs in production.
  - Fix bug where `exisjs build` crashed when env variables were missing during compile-time.
  - Fix bug in `@Body()` pipe resolution where ExisJS schemas were incorrectly run through `transform` instead of `parse`.

## 0.1.9

### Patch Changes

- 2f440b2: fix: load .env variables before config validation to prevent Environment Validation Failed errors

## 0.1.6

### Patch Changes

- fix: prioritize `.exis/server/exis.config.js` over `exis.config.ts` when loading config in production

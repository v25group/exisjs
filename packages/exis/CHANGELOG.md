# exisjs

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

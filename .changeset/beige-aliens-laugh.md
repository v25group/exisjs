---
"exisjs": patch
---

- Fix bug where `autoMountJobs` searched `.ts` files instead of compiled `.js` jobs in production.
- Fix bug where `exisjs build` crashed when env variables were missing during compile-time.
- Fix bug in `@Body()` pipe resolution where ExisJS schemas were incorrectly run through `transform` instead of `parse`.

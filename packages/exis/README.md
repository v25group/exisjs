# exis

The short name for [ExisJS](https://github.com/v25group/exisjs). This package contains no code of its own: it installs `exisjs` and re-exports it, so `import { tex } from 'exis/validator'` and `import { tex } from 'exisjs/validator'` give you the same object. An app that uses both names still holds one copy of the framework.

New projects should use `exisjs`:

```bash
npm create exisjs@latest my-app
```

Documentation: [github.com/v25group/exisjs](https://github.com/v25group/exisjs)

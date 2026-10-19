# @exisjs/cli

The `exisjs` command for [ExisJS](https://github.com/v25group/exisjs) apps: the development server with hot reload, `build`, `test`, `run`, `start` and code generators.

It is a development tool. Install it next to the runtime:

```bash
npm install exisjs
npm install -D @exisjs/cli typescript
```

```json filename="package.json"
{
  "scripts": {
    "dev": "exisjs dev",
    "build": "exisjs build",
    "test": "exisjs test",
    "start": "exisjs start"
  }
}
```

`exisjs start` comes with the `exisjs` runtime itself, so production needs only `exisjs` (`npm ci --omit=dev --omit=optional`): no TypeScript, esbuild or CLI in the image. Every other command needs `@exisjs/cli`.

`@exisjs/cli` is released together with `exisjs` and always has the same version.

## Upgrading from ExisJS 0.9

Before 0.10 the command was part of the `exisjs` package. Run this once in the project:

```bash
npx exisjs migrate
npm install
```

Documentation: [CLI commands](https://github.com/v25group/exisjs/blob/main/docs/content/cli/commands.mdx) · [Deploying with Docker](https://github.com/v25group/exisjs/blob/main/docs/content/deployment.mdx)

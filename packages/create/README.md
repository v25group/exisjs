# create-exisjs

[![npm create-exisjs package](https://img.shields.io/npm/v/create-exisjs.svg)](https://npmjs.org/package/create-exisjs)
[![npm license](https://img.shields.io/npm/l/create-exisjs.svg)](https://github.com/v25group/exisjs/blob/main/LICENSE)
[![GitHub discussions](https://img.shields.io/badge/Discussions-GitHub-blue.svg)](https://github.com/v25group/exisjs/discussions)

`create-exisjs` is the official CLI tool for scaffolding new ExisJS applications with interactive prompts and preconfigured starter templates.

---

## Quickstart

Run the initialization command directly without installing globally:

### npx
```bash
npx create-exisjs@latest my-backend
```

### npm
```bash
npm create exisjs@latest my-backend
```

### pnpm
```bash
pnpm create exisjs@latest my-backend
```

### yarn
```bash
yarn create exisjs my-backend
```

### bun
```bash
bun create exisjs@latest my-backend
```

---

## Non-Interactive & CI Flags

You can pass command-line arguments to skip prompts and automate project generation:

| Flag | Description |
| :--- | :--- |
| `-y`, `--yes` | Skip all interactive prompts and use default settings |
| `--functional` | Select the Functional routing paradigm (`controller`, `route.*`) |
| `--oop` | Select the Class-Based (OOP) routing paradigm (`@Controller`, `@Get`, `@Post`) |
| `--ts`, `--typescript` | Initialize with TypeScript support (default) |
| `--js`, `--javascript` | Initialize with JavaScript support |
| `--eslint` / `--no-eslint` | Enable or disable ESLint configuration |
| `--skip-install` | Generate files without automatically running `npm install` |
| `--skip-git` | Skip initializing a local Git repository |

### Example

```bash
npx create-exisjs@latest my-backend --oop --ts --eslint
```

---

## Generated Project Layout

A generated ExisJS project includes a standard file-system routing structure:

```text
my-backend/
├── src/
│   ├── http/
│   │   ├── server.ts         # Server lifecycle hooks (onStart, onClose)
│   │   ├── boundary.ts       # Root request boundary & security middleware
│   │   ├── route.ts          # Root route handler (GET /)
│   │   └── health/
│   │       └── route.ts      # Healthcheck endpoint (GET /health)
│   ├── config/
│   │   └── env.ts            # Environment schema validation with tex.env
│   ├── database/
│   │   └── db.ts             # Database connection lifecycle setup
│   └── cron/
│       └── cleanup.ts        # Background cron task definitions
├── tests/
│   └── index.test.ts         # Automated test suite using Node.js test runner
├── .env                      # Environment variables
├── exis.config.ts            # Framework configuration
├── package.json              # Scripts (dev, build, start, test)
└── tsconfig.json             # TypeScript configuration with @/* path alias
```

---

## Documentation

For full guides and architecture documentation, visit the [ExisJS Repository](https://github.com/v25group/exisjs) and [exisjs.com](https://exisjs.com).

---

## License

[MIT License](https://github.com/v25group/exisjs/blob/main/LICENSE)

// B8 (docs/REPORT.md): `exisjs migrate` moves a 0.9 app to the @exisjs/cli layout
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from '../../exisjs/src/testing'
import {
  migratePackageJson,
  dockerfileAdvice,
  START_CMD,
} from '../src/commands/migrate'

function app(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exis-migrate-'))
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text)
  }
  return dir
}

// A package.json as create-exisjs 0.9 generated it, without TypeScript
const OLD_PKG = JSON.stringify(
  {
    name: 'shop-api',
    scripts: {
      dev: 'exisjs dev',
      build: 'exisjs build',
      start: 'exisjs start',
    },
    dependencies: { exisjs: '^0.9.2' },
  },
  null,
  2
)

describe('exisjs migrate', () => {
  it('adds @exisjs/cli and TypeScript, and keeps exisjs start', () => {
    const dir = app({ 'package.json': OLD_PKG, 'tsconfig.json': '{}' })
    try {
      const changes = migratePackageJson(dir, true)
      expect(changes).toHaveLength(2)
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
      )
      expect(pkg.devDependencies['@exisjs/cli']).toMatch(/^\^\d+\.\d+\.\d+/)
      expect(pkg.devDependencies.typescript).toMatch(/^\^\d/)
      // The runtime runs `exisjs start` without the CLI, so it stays
      expect(pkg.scripts.start).toBe('exisjs start')
      // dev, build and test keep working through the CLI's own binary
      expect(pkg.scripts.dev).toBe('exisjs dev')
      expect(pkg.dependencies.exisjs).toBe('^0.9.2')
      // Running it again changes nothing
      expect(migratePackageJson(dir, true)).toHaveLength(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes nothing with --dry-run and leaves a custom start script alone', () => {
    const custom = JSON.stringify({
      scripts: { start: 'node dist/server.js' },
      devDependencies: { typescript: '^5.0.0' },
    })
    const dir = app({ 'package.json': custom, 'tsconfig.json': '{}' })
    try {
      const changes = migratePackageJson(dir, false)
      expect(changes).toHaveLength(1)
      expect(changes[0].description).toContain('@exisjs/cli')
      expect(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).toBe(
        custom
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('points out the Dockerfile lines to change', () => {
    const dir = app({
      'package.json': OLD_PKG,
      Dockerfile: [
        'FROM node:24-slim',
        'RUN npm ci --omit=dev',
        'CMD ["npm", "start"]',
      ].join('\n'),
    })
    try {
      const advice = dockerfileAdvice(dir)
      expect(advice).toHaveLength(2)
      expect(advice[0]).toContain('--omit=optional')
      expect(advice[1]).toContain(START_CMD)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  // Alpha test result 12: the CRM deploys with nixpacks on Dokploy
  it('also checks the build line, nixpacks.toml and Procfile', () => {
    const dir = app({
      'package.json': OLD_PKG,
      Dockerfile: 'RUN npx exisjs build\nRUN npx exisjs build --skip-env-check',
      'nixpacks.toml': '[start]\ncmd = "npm start"',
      Procfile: 'web: npm run start',
    })
    try {
      const advice = dockerfileAdvice(dir)
      expect(advice).toHaveLength(3)
      expect(advice[0]).toMatch(/^Dockerfile:1: add --skip-env-check/)
      expect(advice[1]).toContain(
        'nixpacks.toml:2: cmd = "node_modules/.bin/exisjs start"'
      )
      expect(advice[2]).toContain(
        'Procfile:1: web: node_modules/.bin/exisjs start'
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  // Beta test: the CRM's nixpacks build ran `npm run build`, which needs the secrets
  it('flags npm run build when the build script is exisjs build', () => {
    const dir = app({
      'package.json': OLD_PKG,
      Dockerfile: 'RUN npm run build\nRUN npm run build -- --skip-env-check',
      'nixpacks.toml':
        '[phases.build]\ncmds = ["npm run build"]\n# npm run build',
    })
    try {
      const advice = dockerfileAdvice(dir)
      expect(advice).toHaveLength(2)
      expect(advice[0]).toMatch(/^Dockerfile:1: add --skip-env-check/)
      expect(advice[1]).toMatch(/^nixpacks.toml:2: add --skip-env-check/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

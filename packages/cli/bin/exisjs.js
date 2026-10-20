#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const cwd = process.cwd()
const command = process.argv[2]
const resolveFromProject = (id) => {
  try {
    return require.resolve(id, { paths: [cwd] })
  } catch {
    return null
  }
}

// A global install hands off to the project's own @exisjs/cli, so the app
// runs with the project's exisjs instead of a second copy next to this one
const local = resolveFromProject('@exisjs/cli/bin/exisjs.js')
if (local && fs.realpathSync(local) !== fs.realpathSync(__filename)) {
  require(local)
  return
}
const runtimePkg = !local && resolveFromProject('exisjs/package.json')
if (runtimePkg) {
  // The CLI's peer dependency pins exisjs exactly, so name the matching
  // version: a bare install takes `latest`, which may be an older release
  const { version } = JSON.parse(fs.readFileSync(runtimePkg, 'utf8'))
  console.error(
    '\n  This project has exisjs but not @exisjs/cli, so the exisjs command ' +
      'installed globally would run a second copy of the framework.\n' +
      '  Install the CLI in the project:\n\n' +
      `    npm install -D @exisjs/cli@${version}\n`
  )
  process.exit(1)
}

// Projects that get the CLI only through exisjs's optional dependency,
// which exisjs 0.11 drops
try {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
  )
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  if (
    deps.exisjs &&
    !deps['@exisjs/cli'] &&
    command !== 'migrate' &&
    !process.env.EXIS_NO_CLI_NOTICE
  ) {
    console.error(
      '\x1b[33m[exis]\x1b[0m The CLI moved to @exisjs/cli; exisjs 0.11 stops installing it. ' +
        'Run \x1b[36mnpx exisjs migrate\x1b[0m to update this project.'
    )
  }
} catch {
  // no package.json: nothing to suggest
}

require('../dist/index.js')

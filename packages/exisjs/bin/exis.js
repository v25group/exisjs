#!/usr/bin/env node
// `exisjs start` runs here, from the runtime, so production installs need no
// development tools. Every other command is in @exisjs/cli; this binary
// forwards to it.
const fs = require('node:fs')
const path = require('node:path')

const [command, ...args] = process.argv.slice(2)

if (command === 'start') {
  const options = {}
  const names = {
    '-p': 'port',
    '--port': 'port',
    '-H': 'host',
    '--host': 'host',
    '-e': 'entry',
    '--entry': 'entry',
  }
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split('=')
    if (flag === '-h' || flag === '--help') {
      console.log(
        'Usage: exisjs start [--port <port>] [--host <host>] [--entry <file>]'
      )
      process.exit(0)
    }
    const name = names[flag]
    if (!name) {
      console.error(`Unknown option for exisjs start: ${args[i]}`)
      process.exit(1)
    }
    options[name] = inline ?? args[++i]
  }
  require('../dist/lib/start-command.js')
    .startBuiltServer(options)
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
  return
}

let cli
try {
  cli = require.resolve('@exisjs/cli/bin/exisjs.js', {
    paths: [process.cwd(), __dirname],
  })
} catch {
  console.error(
    `\n  \`exisjs ${command ?? ''}\` is in the @exisjs/cli package, which is not installed.\n` +
      '  Install it as a development dependency:\n\n' +
      '    npm install -D @exisjs/cli\n\n' +
      '  (`exisjs start` needs only exisjs, so production installs can leave it out.)\n'
  )
  process.exit(1)
}

// One line, only for projects that rely on the package installed through
// the runtime instead of listing it themselves
try {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
  )
  const listed =
    pkg.devDependencies?.['@exisjs/cli'] || pkg.dependencies?.['@exisjs/cli']
  if (!listed && command !== 'migrate' && !process.env.EXIS_NO_CLI_NOTICE) {
    console.error(
      '\x1b[33m[exis]\x1b[0m The CLI moved to @exisjs/cli; exisjs 0.11 stops installing it. ' +
        'Run \x1b[36mnpx exisjs migrate\x1b[0m to update this project.'
    )
  }
} catch {
  // no package.json: nothing to suggest
}

require(cli)

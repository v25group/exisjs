#!/usr/bin/env node
// `exisjs start` runs here, from the runtime, so production installs need no
// development tools. Every other command is in @exisjs/cli; this binary
// forwards to it.

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
      // The CLI pins exisjs exactly; a bare install takes `latest`, which may not match
      `    npm install -D @exisjs/cli@${require('../package.json').version}\n\n` +
      '  (`exisjs start` needs only exisjs, so production installs can leave it out.)\n'
  )
  process.exit(1)
}

// The CLI prints the `migrate` notice for projects that don't list it
require(cli)

import cp from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { c } from '../utils'

export async function initCommand() {
  console.log(`\n${c.bold}${c.green}Initializing Exis Project...${c.reset}\n`)

  let version = 'latest'
  try {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json')
    version = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version
  } catch {
    /* ignore */
  }

  // In development, the create-exis package is located relative to the exis package
  // dist/cli/commands/init.js -> ../../../../create-exis/dist/index.js
  const localCreateExis = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'create-exis',
    'dist',
    'index.js'
  )

  if (fs.existsSync(localCreateExis)) {
    cp.spawnSync(process.execPath, [localCreateExis, '.'], {
      stdio: 'inherit',
    })
  } else {
    // In production, run the exact matching version of create-exis to prevent skew
    cp.spawnSync('npx', [`create-exis@${version}`, '.'], {
      stdio: 'inherit',
      shell: true,
    })
  }
}

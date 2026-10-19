import path from 'node:path'
import fs from 'node:fs'
import { c, success } from '../utils'

export interface CleanOptions {
  all?: boolean
}

export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  const cwd = process.cwd()
  const exisDir = path.join(cwd, '.exis')
  const distDir = path.join(cwd, 'dist')

  let cleaned = 0

  if (fs.existsSync(exisDir)) {
    fs.rmSync(exisDir, { recursive: true, force: true })
    cleaned++
  }

  if (options.all && fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true })
    cleaned++
  }

  if (cleaned > 0) {
    success('Cleaned .exis build artifacts and cached types.')
  } else {
    console.log(`${c.dim}No build artifacts found to clean.${c.reset}`)
  }
}

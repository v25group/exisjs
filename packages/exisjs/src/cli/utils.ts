// Terminal colors (no chalk dependency needed for these basics)
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
  bgCyan: '\x1b[46m',
  bgBlack: '\x1b[40m',
  bgMagenta: '\x1b[45m',
  primary: '\x1b[38;2;160;70;255m',
  blue: '\x1b[38;2;41;169;206m',
}

export function banner(): void {
  console.log(`
${c.primary}${c.bold} ███████╗██╗  ██╗██╗███████╗      ██╗███████╗${c.reset}
${c.primary}${c.bold} ██╔════╝╚██╗██╔╝██║██╔════╝      ██║██╔════╝${c.reset}
${c.primary}${c.bold} █████╗   ╚███╔╝ ██║███████╗      ██║███████╗${c.reset}
${c.primary}${c.bold} ██╔══╝   ██╔██╗ ██║╚════██║ ██   ██║╚════██║${c.reset}
${c.primary}${c.bold} ███████╗██╔╝ ██╗██║███████║ ███████║███████║${c.reset}
${c.primary}${c.bold} ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝ ╚══════╝╚══════╝${c.reset}
${c.gray}  The elegantly structured TypeScript Node.js framework${c.reset}
`)
}

export function log(msg: string): void {
  console.log(`  ${msg}`)
}

export function success(msg: string): void {
  console.log(`${c.green}✓${c.reset} ${msg}`)
}

export function warn(msg: string): void {
  console.log(`${c.yellow}⚠${c.reset} ${msg}`)
}

export function error(msg: string): void {
  console.error(`${c.red}✗${c.reset} ${msg}`)
}

export function info(msg: string): void {
  console.log(`${c.gray}  ${msg}${c.reset}`)
}

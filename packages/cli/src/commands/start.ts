// The implementation lives in the runtime, which runs `exisjs start` on its
// own when @exisjs/cli is not installed (production)
export { startBuiltServer as startCommand } from 'exisjs/internal'

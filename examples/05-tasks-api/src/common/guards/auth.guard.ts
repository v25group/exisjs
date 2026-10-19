import type { ExecutionContext } from 'exisjs/decorators'
// Functional Guard Example
// PLACEHOLDER: this only checks that the header exists, so any value is
// accepted. Verify the token (signature and expiry) before using this.
export const authGuard = async (context: ExecutionContext) => {
  const token = context.switchToHttp().getRequest().headers.authorization
  return Boolean(token)
}

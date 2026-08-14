export interface RouteLookupResult {
  routeId: number
  params: Record<string, string>
}

export class RadixRouter {
  constructor()
  insert(method: string, path: string, routeId: number): void
  search(method: string, path: string): RouteLookupResult | null
}

export class TexValidator {
  constructor(
    schemaDefinition: Record<string, string>,
    strict?: boolean | undefined | null
  )
  parse(data: any): any
}

export function escapeHtml(s: string): string
export function stripHtml(s: string): string
export function preventSql(s: string): string
export function preventTraversal(s: string): string
export function maskEmail(s: string): string
export function maskString(s: string): string
export function parseJsonBody(input: string): any
export function stripPrototype(data: any): any
export function parseCookies(header: string): Record<string, string>
export function signJwt(
  payload: any,
  secret: string,
  expiresIn?: number | undefined | null
): string
export function verifyJwt(token: string, secrets: string[]): any
export function generateEtag(content: Buffer): string

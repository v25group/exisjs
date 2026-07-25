export * from './types'
export { ExisQueue } from './client'
export { ExisWorker } from './worker'

export function defineJob<
  Schema extends { parse: (val: any) => any },
  T = Schema extends { parse: (val: any) => infer U } ? U : unknown,
>(
  def: Omit<import('./types').JobDefinition<T>, 'schema'> & { schema: Schema }
): import('./types').JobDefinition<T>
export function defineJob<T = unknown>(
  def: import('./types').JobDefinition<T>
): import('./types').JobDefinition<T>
export function defineJob(def: any) {
  return def
}

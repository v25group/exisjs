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

import { getActiveApp } from '../server/app'
import type { JobOptions } from './types'

export async function enqueue<T = unknown>(
  name: string,
  payload: T,
  opts?: JobOptions
): Promise<string> {
  return getActiveApp().enqueue(name, payload, opts)
}

export function queue<T = unknown>(
  name: string,
  handler: import('./types').JobHandler<T>,
  options?: Omit<import('./types').JobDefinition<T>, 'name' | 'handler'>
) {
  return getActiveApp().queue(name, handler, options)
}

queue.enqueue = enqueue

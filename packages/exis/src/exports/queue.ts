import { getActiveApp } from '../server/app'
import type { JobOptions } from '../queue/types'

export { defineJob } from '../queue/index'
export type {
  JobPayload,
  JobOptions,
  JobDefinition,
  JobHandler,
} from '../queue/types'

export async function enqueue<T = unknown>(
  name: string,
  payload: T,
  opts?: JobOptions
): Promise<string> {
  return getActiveApp().enqueue(name, payload, opts)
}

export function queue<T = unknown>(
  name: string,
  handler: import('../queue/types').JobHandler<T>,
  options?: Omit<import('../queue/types').JobDefinition<T>, 'name' | 'handler'>
) {
  return getActiveApp().queue(name, handler, options)
}

queue.enqueue = enqueue

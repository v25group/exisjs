import { getCacheStore } from './store'

export async function revalidateTag(tag: string): Promise<void> {
  const store = getCacheStore()
  await store.revalidateTag(tag)
}

export * from '../middleware/cache'
export * from './store'

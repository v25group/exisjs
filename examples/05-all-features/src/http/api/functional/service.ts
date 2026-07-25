import { getLoaders } from '@/loaders'

export async function fetchUserFromLoader(id: string) {
  const { user: userLoader } = getLoaders()
  return await userLoader.load(id)
}

export async function fetchBatchUsersFromLoader(ids: string[]) {
  const { user: userLoader } = getLoaders()
  return await userLoader.loadMany(ids)
}

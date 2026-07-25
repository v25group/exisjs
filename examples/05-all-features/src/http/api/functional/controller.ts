import { fetchUserFromLoader, fetchBatchUsersFromLoader } from './service'

export async function getUserHandler({ params }: { params: { id: string } }) {
  const user = await fetchUserFromLoader(params.id)
  return { source: 'functional', user }
}

export async function getBatchUsersHandler({ body }: { body: { ids: string[] } }) {
  const users = await fetchBatchUsersFromLoader(body.ids)
  return { source: 'functional', users }
}

const fakeDb = [
  { id: '1', name: 'Alice', role: 'admin' },
  { id: '2', name: 'Bob', role: 'user' },
  { id: '3', name: 'Charlie', role: 'user' },
]

export async function fetchUser(id: string) {
  return fakeDb.find((u) => u.id === id) || null
}

export async function fetchBatchUsers(ids: string[]) {
  return fakeDb.filter((u) => ids.includes(u.id))
}

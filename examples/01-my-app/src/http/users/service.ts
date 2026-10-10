export interface User {
  id: number
  name: string
  email: string
  passwordHash: string
}

export type PublicUser = Omit<User, 'passwordHash'>

// In-memory store so the example runs without a database.
// Replace these methods with real queries in an application.
const users: User[] = []
let nextId = 1

export class UsersService {
  findAll(): PublicUser[] {
    return users.map(toPublic)
  }

  findById(id: number): PublicUser | undefined {
    const user = users.find((u) => u.id === id)
    return user && toPublic(user)
  }

  findByEmail(email: string): User | undefined {
    return users.find((u) => u.email === email)
  }

  create(data: Omit<User, 'id'>): PublicUser {
    const user = { id: nextId++, ...data }
    users.push(user)
    return toPublic(user)
  }
}

function toPublic(user: User): PublicUser {
  return { id: user.id, name: user.name, email: user.email }
}

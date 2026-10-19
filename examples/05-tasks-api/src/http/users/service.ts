import { HttpError } from 'exisjs/error'
import type { CreateUserDto } from './schema'

export interface User {
  id: number
  name: string
  email: string
  createdAt: Date
}
// In-memory user store
const users: User[] = []

export async function createUser(userDto: CreateUserDto): Promise<User> {
  // Keep the password out of what is stored and returned; a real app
  // hashes it (argon2, bcrypt) and stores only the hash
  const newUser = {
    id: Date.now(),
    name: userDto.name,
    email: userDto.email,
    createdAt: new Date(),
  }
  users.push(newUser)
  return newUser
}

export async function getUsers(): Promise<User[]> {
  return users
}

export async function getUserById(id: string): Promise<User> {
  const user = users.find((u) => String(u.id) === id)
  if (!user) throw HttpError.notFound('User')
  return user
}

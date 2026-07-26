import { Injectable } from 'exisjs/decorators'

@Injectable()
export class AdminPostsService {
  async create(data: { name: string }) {
    return { id: Date.now(), name: data.name, created: true }
  }

  async list() {
    return [{ id: 1, name: 'Sample AdminPosts' }]
  }
}

import { Injectable } from 'exisjs/decorators'
import { getLoaders } from '@/loaders'

@Injectable()
export class UserService {
  async fetchUser(id: string) {
    const { user: userLoader } = getLoaders()
    return await userLoader.load(id)
  }

  async fetchBatchUsers(ids: string[]) {
    const { user: userLoader } = getLoaders()
    return await userLoader.loadMany(ids)
  }
}

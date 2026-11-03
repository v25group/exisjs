import cluster from 'node:cluster'
import { exis } from 'exisjs'
import { serveStatic } from 'exisjs/middleware'
import { hashPassword } from '@/common/password'
import { env } from '@/config/env'
import { Note, Session, User } from '@/database/db'

export default exis({
  async onStart(app) {
    app.use(serveStatic('public'))

    // A fresh database per run keeps the attack suite repeatable.
    // In a cluster every worker runs this, so only the first one does it.
    if (cluster.worker && cluster.worker.id !== 1) return

    await Promise.all([
      User.deleteMany({}),
      Note.deleteMany({}),
      Session.deleteMany({}),
    ])
    await User.create({
      email: env.ADMIN_EMAIL,
      name: 'Admin',
      role: 'admin',
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
    })
  },
})

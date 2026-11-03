import { HttpError } from 'exisjs/error'
import { Note } from '@/database/db'

const present = (doc: any) => ({
  id: String(doc._id),
  title: doc.title,
  body: doc.body,
})

// Someone else's note answers 404, so its existence isn't revealed
const notFound = () => HttpError.notFound('Note')

export async function list(ownerId: string) {
  return (await Note.find({ ownerId }).limit(100).lean()).map(present)
}

export async function create(ownerId: string, input: any) {
  return present(await Note.create({ ...input, ownerId }))
}

export async function read(ownerId: string, id: string) {
  const doc = await Note.findOne({ _id: id, ownerId }).lean()
  if (!doc) throw notFound()
  return present(doc)
}

export async function remove(ownerId: string, id: string) {
  const { deletedCount } = await Note.deleteOne({ _id: id, ownerId })
  if (deletedCount === 0) throw notFound()
}

export async function search(ownerId: string, q: string) {
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (
    await Note.find({ ownerId, title: { $regex: escaped, $options: 'i' } })
      .limit(100)
      .lean()
  ).map(present)
}

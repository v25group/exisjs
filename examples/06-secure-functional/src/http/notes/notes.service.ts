import { ObjectId } from 'mongodb'
import { HttpError } from 'exisjs/error'
import { notes } from '@/database/db'

const present = (doc: any) => ({
  id: doc._id.toHexString(),
  title: doc.title,
  body: doc.body,
})

// Someone else's note answers 404, so its existence isn't revealed
const notFound = () => HttpError.notFound('Note')

export async function list(ownerId: string) {
  return (await notes.find({ ownerId }).limit(100).toArray()).map(present)
}

export async function create(ownerId: string, input: any) {
  const doc = { ...input, ownerId }
  const { insertedId } = await notes.insertOne(doc)
  return present({ ...doc, _id: insertedId })
}

export async function read(ownerId: string, id: string) {
  const doc = await notes.findOne({ _id: new ObjectId(id), ownerId })
  if (!doc) throw notFound()
  return present(doc)
}

export async function remove(ownerId: string, id: string) {
  const { deletedCount } = await notes.deleteOne({
    _id: new ObjectId(id),
    ownerId,
  })
  if (deletedCount === 0) throw notFound()
}

export async function search(ownerId: string, q: string) {
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (
    await notes
      .find({ ownerId, title: { $regex: escaped, $options: 'i' } })
      .limit(100)
      .toArray()
  ).map(present)
}

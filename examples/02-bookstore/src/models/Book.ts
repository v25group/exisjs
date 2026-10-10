import mongoose, { type Model, type Types } from 'mongoose'

export interface IBook {
  title: string
  caption: string
  image: string
  rating: number
  user: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const bookSchema = new mongoose.Schema<IBook>(
  {
    title: { type: String, required: true },
    caption: { type: String, required: true },
    image: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
)

export const Book =
  (mongoose.models.Book as Model<IBook>) ||
  mongoose.model<IBook>('Book', bookSchema)

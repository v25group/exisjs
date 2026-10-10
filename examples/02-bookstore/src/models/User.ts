import mongoose, { type HydratedDocument, type Model } from 'mongoose'
import bcrypt from 'bcryptjs'

export interface IUser {
  username: string
  email: string
  password: string
  profileImage: string
  createdAt: Date
  updatedAt: Date
}

interface UserMethods {
  comparePassword(candidate: string): Promise<boolean>
}

export type UserDocument = HydratedDocument<IUser, UserMethods>
type UserModel = Model<IUser, object, UserMethods>

const userSchema = new mongoose.Schema<IUser, UserModel, UserMethods>(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    // Never returned by queries unless explicitly selected
    password: { type: String, required: true, select: false },
    profileImage: { type: String, default: '' },
  },
  { timestamps: true }
)

// The only place passwords are hashed. Routes pass the plain password; hashing
// it there as well would hash it twice and make every login fail.
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return
  this.password = await bcrypt.hash(this.password, 10)
})

userSchema.methods.comparePassword = function (candidate: string) {
  return bcrypt.compare(candidate, this.password)
}

export const User =
  (mongoose.models.User as UserModel) ||
  mongoose.model<IUser, UserModel>('User', userSchema)

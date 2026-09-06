import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    profileImage: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
)

// hash password before saving user to db
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return

  this.password = await bcrypt.hash(this.password, 10)
})

// compare password func
userSchema.methods.comparePassword = async function (userPassword: string) {
  return await bcrypt.compare(userPassword, this.password)
}

export const User = mongoose.models.User || mongoose.model('User', userSchema)

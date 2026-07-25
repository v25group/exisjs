import { Controller, Use, Get, Post, Delete, Body, Query, Param, Req } from 'exisjs/decorators'
import { v } from 'exisjs/validator'
import type { Infer } from 'exisjs/validator'
import { HttpError } from 'exisjs/error'
import cloudinary from '@/lib/cloudinary'
import { Book } from '@/models/Book'
import { protectRoute } from '@/middleware/auth'

const CreateBookSchema = v.object({
  title: v.string(),
  caption: v.string(),
  rating: v.number(),
  image: v.string(),
})

type CreateBookDto = Infer<typeof CreateBookSchema>

@Use(protectRoute)
@Controller()
export default class BooksController {
  
  @Get('/')
  async list(@Query('page') pageStr: string, @Query('limit') limitStr: string) {
    const page = parseInt(pageStr) || 1
    const limit = parseInt(limitStr) || 2
    const skip = (page - 1) * limit

    const books = await Book.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'username profileImage')

    const totalBooks = await Book.countDocuments()

    return {
      books,
      currentPage: page,
      totalBooks,
      totalPages: Math.ceil(totalBooks / limit),
    }
  }

  @Get('/user')
  async userBooks(@Req() req: any) {
    const books = await Book.find({ user: req.user?._id }).sort({
      createdAt: -1,
    })
    return books
  }

  @Post('/')
  async create(@Body(CreateBookSchema) body: CreateBookDto, @Req() req: any) {
    // upload the image to cloudinary
    const uploadResponse = await cloudinary.uploader.upload(body.image)
    const imageUrl = uploadResponse.secure_url

    // save to the database
    const newBook = new Book({
      title: body.title,
      caption: body.caption,
      rating: body.rating,
      image: imageUrl,
      user: req.user._id,
    })

    await newBook.save()
    return newBook
  }

  @Delete('/:id')
  async delete(@Param('id') id: string, @Req() req: any) {
    const book = await Book.findById(id)
    if (!book) throw HttpError.notFound('Book not found')

    // check if user is the creator of the book
    if (book.user.toString() !== req.user._id.toString()) {
      throw HttpError.unauthorized('Unauthorized')
    }

    // delete image from cloudinary as well
    if (book.image && book.image.includes('cloudinary')) {
      try {
        const publicId = book.image.split('/').pop()?.split('.')[0]
        if (publicId) await cloudinary.uploader.destroy(publicId)
      } catch (deleteError) {
        console.log('Error deleting image from cloudinary', deleteError)
      }
    }

    await book.deleteOne()
    return { message: 'Book deleted successfully' }
  }
}

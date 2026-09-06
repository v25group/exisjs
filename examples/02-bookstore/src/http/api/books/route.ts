import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  Req,
  UploadedFile,
} from 'exisjs/decorators'
import { Idempotent } from 'exisjs/decorators'
import type { ExisFile } from 'exisjs/router'
import { tex } from 'exisjs/validator'
import type { Infer } from 'exisjs/validator'
import { HttpError } from 'exisjs/error'
import cloudinary from '@/lib/cloudinary'
import { Book } from '@/models/Book'

const CreateBookSchema = tex.object({
  title: tex.string(),
  caption: tex.string(),
  rating: tex.number(),
  image: tex.string(),
})

type CreateBookDto = Infer<typeof CreateBookSchema>

// @Use(protectRoute)
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

  @Post('/checkout')
  @Idempotent()
  async checkout(@Body(tex.object({ bookId: tex.string() })) body: any) {
    console.log('Processing checkout for book:', body.bookId)
    // simulate a long checkout process
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return {
      success: true,
      message: 'Checkout successful',
      bookId: body.bookId,
    }
  }

  @Post('/cover')
  async uploadCover(@UploadedFile() file: ExisFile) {
    if (!file) {
      throw HttpError.badRequest('No cover file uploaded')
    }

    const destDir = './uploads'
    const savedPath = await file.saveToDisk(destDir)

    return {
      success: true,
      message: 'Cover uploaded successfully',
      filename: file.filename,
      size: file.size,
      path: savedPath,
    }
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

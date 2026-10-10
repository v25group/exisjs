import path from 'node:path'
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  Req,
  Use,
  HttpCode,
  UploadedFile,
  Idempotent,
} from 'exisjs/decorators'
import type { ExisFile } from 'exisjs/router'
import { tex } from 'exisjs/validator'
import type { Infer } from 'exisjs/validator'
import { BadRequestError, ForbiddenError, NotFoundError } from 'exisjs/error'
import { Book } from '@/models/Book'
import { protectRoute, type AuthedRequest } from '@/middleware/auth'

const CreateBookSchema = tex.object({
  title: tex.string({ min: 1, max: 200, trim: true }),
  caption: tex.string({ min: 1, max: 1000, trim: true }),
  rating: tex.number({ min: 1, max: 5 }),
  image: tex.string({ min: 1, max: 2000 }),
})
type CreateBookDto = Infer<typeof CreateBookSchema>

const CheckoutSchema = tex.object({ bookId: tex.string({ min: 1 }) })
type CheckoutDto = Infer<typeof CheckoutSchema>

// MongoDB ids are 24 hex characters; anything else can never match a book
const OBJECT_ID = /^[0-9a-f]{24}$/i

@Controller()
export default class BooksController {
  // Public: anyone can browse
  @Get('/')
  async list(@Query('page') pageStr?: string, @Query('limit') limitStr?: string) {
    const page = Math.max(1, Number.parseInt(pageStr ?? '', 10) || 1)
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(limitStr ?? '', 10) || 10)
    )

    const [books, totalBooks] = await Promise.all([
      Book.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'username profileImage'),
      Book.countDocuments(),
    ])

    return {
      books,
      currentPage: page,
      totalBooks,
      totalPages: Math.ceil(totalBooks / limit),
    }
  }

  @Get('/user')
  @Use(protectRoute)
  userBooks(@Req() req: AuthedRequest) {
    return Book.find({ user: req.user._id }).sort({ createdAt: -1 })
  }

  @Post('/')
  @Use(protectRoute)
  @HttpCode(201)
  create(
    @Body(CreateBookSchema) body: CreateBookDto,
    @Req() req: AuthedRequest
  ) {
    return Book.create({ ...body, user: req.user._id })
  }

  // Sending the same Idempotency-Key header twice returns the first response
  // instead of running the handler again
  @Post('/checkout')
  @Use(protectRoute)
  @Idempotent()
  async checkout(@Body(CheckoutSchema) body: CheckoutDto) {
    await new Promise((resolve) => setTimeout(resolve, 200)) // simulated work
    return { message: 'Checkout successful', bookId: body.bookId }
  }

  @Post('/cover')
  @Use(protectRoute)
  async uploadCover(@UploadedFile() file?: ExisFile) {
    if (!file) throw new BadRequestError('No cover file uploaded')

    const savedPath = await file.saveToDisk('./uploads')
    // Return the stored name, never the server's filesystem path
    return {
      filename: path.basename(savedPath),
      originalName: file.filename,
      size: file.size,
    }
  }

  @Delete('/:id')
  @Use(protectRoute)
  async delete(@Param('id') id: string, @Req() req: AuthedRequest) {
    if (!OBJECT_ID.test(id)) throw new NotFoundError('Book')

    const book = await Book.findById(id)
    if (!book) throw new NotFoundError('Book')
    if (!book.user.equals(req.user._id)) {
      throw new ForbiddenError('Only the owner can delete this book')
    }

    await book.deleteOne()
    return { message: 'Book deleted' }
  }
}

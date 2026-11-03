import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Idempotent,
  Param,
  Post,
  Query,
  Req,
} from 'exisjs/decorators'
import { noteBody, noteParams, searchQuery } from './notes.schema'
import * as notes from './notes.service'

@Controller()
export default class NotesController {
  @Get('/')
  list(@Req() req: any) {
    return notes.list(req.user.id)
  }

  @Get('/search')
  search(@Req() req: any, @Query(searchQuery) query: { q: string }) {
    return notes.search(req.user.id, query.q)
  }

  @Post('/')
  @Idempotent()
  @HttpCode(201)
  create(@Req() req: any, @Body(noteBody) body: any) {
    return notes.create(req.user.id, body)
  }

  @Get('/:id')
  read(@Req() req: any, @Param(noteParams) params: { id: string }) {
    return notes.read(req.user.id, params.id)
  }

  @Delete('/:id')
  @HttpCode(204)
  remove(@Req() req: any, @Param(noteParams) params: { id: string }) {
    return notes.remove(req.user.id, params.id)
  }
}

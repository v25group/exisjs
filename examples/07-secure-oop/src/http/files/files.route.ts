import path from 'node:path'
import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseUpload,
} from 'exisjs/decorators'
import { tex } from 'exisjs/validator'

const UPLOADS = path.resolve('uploads')
const FileParams = tex.object({ name: tex.string({ max: 300 }) })

@Controller()
export default class FilesController {
  @Post('/')
  @HttpCode(201)
  @UseUpload({
    field: 'file',
    maxSize: '100KB',
    allowedMimeTypes: ['image/png', 'text/plain'],
    destination: 'memory',
  })
  async upload(@UploadedFile() file: any) {
    if (!file) return { saved: null }
    const saved = await file.saveToDisk(UPLOADS)
    return { saved: path.basename(saved), original: file.filename }
  }

  @Get('/:name')
  download(@Param(FileParams) params: { name: string }, @Res() res: any) {
    return res.download(params.name, 'download.bin', { root: UPLOADS })
  }
}

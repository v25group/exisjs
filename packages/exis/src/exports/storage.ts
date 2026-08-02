import type { ExisRequest } from '../server/request'

export interface StorageOptions {
  dest: string
}

export async function streamUpload(
  req: ExisRequest<any, any, any>,
  options: StorageOptions
) {
  return await req.streamUpload(options.dest)
}

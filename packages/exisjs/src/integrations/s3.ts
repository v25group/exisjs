/**
 * Zero-config AWS S3 Integration.
 *
 * Automatically initializes the AWS S3 client using standard environment variables:
 * - AWS_ACCESS_KEY_ID
 * - AWS_SECRET_ACCESS_KEY
 * - AWS_REGION
 *
 * Peer Dependencies required:
 *   npm install @aws-sdk/client-s3
 */

export function createS3Client(options: any = {}) {
  const region =
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || options.region
  const accessKeyId =
    process.env.AWS_ACCESS_KEY_ID || options.credentials?.accessKeyId
  const secretAccessKey =
    process.env.AWS_SECRET_ACCESS_KEY || options.credentials?.secretAccessKey

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS credentials (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) are missing in environment.'
    )
  }

  let S3Client: any

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('@aws-sdk/client-s3')
    S3Client = pkg.S3Client
  } catch {
    throw new Error(
      'Missing dependencies. Please run: npm install @aws-sdk/client-s3'
    )
  }

  return new S3Client({
    ...options,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  })
}

let cachedClient: any

export function configureS3(options: any) {
  if (cachedClient) {
    console.warn(
      'S3 client is already initialized. Call configureS3() before using it.'
    )
    return cachedClient
  }
  cachedClient = createS3Client(options)
  return cachedClient
}

export const s3 = new Proxy(
  {},
  {
    get(target, prop) {
      if (!cachedClient) {
        cachedClient = createS3Client()
      }
      const value = cachedClient[prop]
      return typeof value === 'function' ? value.bind(cachedClient) : value
    },
  }
)

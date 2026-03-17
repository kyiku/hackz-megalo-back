import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const client = new S3Client({ useAccelerateEndpoint: true })

const bucketName = (): string => {
  const name = process.env.S3_BUCKET
  if (!name) throw new Error('S3_BUCKET is not set')
  return name
}

/** Generate a presigned PUT URL for uploading (Transfer Acceleration). */
export const generatePresignedUploadUrl = async (
  key: string,
  contentType = 'image/jpeg',
  expiresIn = 300,
): Promise<string> => {
  const command = new PutObjectCommand({
    Bucket: bucketName(),
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(client, command, { expiresIn })
}

/** Generate a presigned GET URL for downloading. */
export const generatePresignedDownloadUrl = async (
  key: string,
  expiresIn = 300,
): Promise<string> => {
  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: key,
  })
  return getSignedUrl(client, command, { expiresIn })
}

/** Get an object from S3 as a Buffer. */
export const getObject = async (key: string): Promise<Buffer> => {
  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: key,
  })
  const response = await client.send(command)
  const bytes = await response.Body?.transformToByteArray()
  if (!bytes) throw new Error(`Empty body for key: ${key}`)
  return Buffer.from(bytes)
}

/** Put an object into S3. */
export const putObject = async (
  key: string,
  body: Buffer,
  contentType = 'image/png',
): Promise<void> => {
  const command = new PutObjectCommand({
    Bucket: bucketName(),
    Key: key,
    Body: body,
    ContentType: contentType,
  })
  await client.send(command)
}

export { bucketName }

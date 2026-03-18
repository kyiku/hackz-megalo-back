import type { APIGatewayProxyHandler } from 'aws-lambda'
import { getSessionByDownloadCode } from '../../lib/dynamodb'
import { generatePresignedDownloadUrl } from '../../lib/s3'
import { success, error } from '../../utils/response'

const PRESIGNED_URL_EXPIRES_IN = 3600 // 1 hour

export const handler: APIGatewayProxyHandler = async (event) => {
  const code = event.pathParameters?.code
  if (!code) return error('code is required', 400)

  const session = await getSessionByDownloadCode(code)
  if (!session) return error('Code not found', 404)

  const imageKey = session.downloadKey ?? session.collageImageKey
  if (!imageKey) return error('Image not ready', 404)

  const downloadUrl = await generatePresignedDownloadUrl(imageKey, PRESIGNED_URL_EXPIRES_IN)

  return success({ downloadUrl, sessionId: session.sessionId }, 200)
}

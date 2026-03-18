import type { APIGatewayProxyHandler } from 'aws-lambda'
import { generatePresignedUploadUrl } from '../../lib/s3'
import { getSession } from '../../lib/dynamodb'
import { success, error } from '../../utils/response'

export const handler: APIGatewayProxyHandler = async (event) => {
  const sessionId = event.pathParameters?.sessionId
  if (!sessionId) return error('sessionId is required', 400)

  const session = await getSession(sessionId)
  if (!session) return error('Session not found', 404)

  const key = `yaji-frames/${sessionId}/${String(Date.now())}.jpg`
  const uploadUrl = await generatePresignedUploadUrl(key, 'image/jpeg', 60)

  return success({ uploadUrl, key }, 200)
}

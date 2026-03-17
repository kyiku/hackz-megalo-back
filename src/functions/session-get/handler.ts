import type { APIGatewayProxyHandler } from 'aws-lambda'
import { getSession } from '../../lib/dynamodb'
import { generatePresignedDownloadUrl } from '../../lib/s3'
import { success, error } from '../../utils/response'

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const sessionId = event.pathParameters?.sessionId
    if (!sessionId) {
      return error('sessionId is required', 400)
    }

    const session = await getSession(sessionId)
    if (!session) {
      return error('Session not found', 404)
    }

    // Generate presigned URL for collage download if available
    const collageImageUrl = session.downloadKey
      ? await generatePresignedDownloadUrl(session.downloadKey, 3600)
      : undefined

    return success({
      sessionId: session.sessionId,
      status: session.status,
      filterType: session.filterType,
      filter: session.filter,
      caption: session.caption,
      collageImageUrl,
      createdAt: session.createdAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return error(message, 500)
  }
}

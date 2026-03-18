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

    // Generate presigned URL for print-ready receipt image
    const printImageUrl = session.printImageKey
      ? await generatePresignedDownloadUrl(session.printImageKey, 3600)
      : undefined

    return success({
      sessionId: session.sessionId,
      status: session.status,
      filterType: session.filterType,
      filter: session.filter,
      caption: session.caption,
      collageImageUrl,
      printImageUrl,
      downloadCode: session.downloadCode,
      createdAt: session.createdAt,
    })
  } catch (err) {
    console.error('session-get failed:', err)
    return error('Internal server error', 500)
  }
}

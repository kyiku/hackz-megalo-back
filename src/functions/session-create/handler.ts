import type { APIGatewayProxyHandler } from 'aws-lambda'
import { randomUUID } from 'node:crypto'
import { CreateSessionSchema } from '../../utils/validation'
import { putSession } from '../../lib/dynamodb'
import { generatePresignedUploadUrl } from '../../lib/s3'
import { success, error } from '../../utils/response'
import type { Session } from '../../lib/types'

const TTL_DAYS = 30

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const websocketUrl = process.env.WEBSOCKET_URL
    if (!websocketUrl) {
      console.error('Missing required configuration: WEBSOCKET_URL')
      return error('Service configuration error', 500)
    }

    let body: unknown
    try {
      body = JSON.parse(event.body ?? '{}')
    } catch {
      return error('Invalid JSON in request body', 400)
    }

    const parsed = CreateSessionSchema.safeParse(body)
    if (!parsed.success) {
      return error(parsed.error.message, 400)
    }

    const { filterType, filter, photoCount } = parsed.data
    const sessionId = randomUUID()
    const now = new Date()

    const session: Session = {
      sessionId,
      createdAt: now.toISOString(),
      filterType,
      filter,
      status: 'uploading',
      photoCount,
      ttl: Math.floor(now.getTime() / 1000) + TTL_DAYS * 86400,
    }

    const uploadUrls = await Promise.all(
      Array.from({ length: photoCount }, async (_, i) => ({
        index: i + 1,
        url: await generatePresignedUploadUrl(
          `originals/${sessionId}/${String(i + 1)}.jpg`,
        ),
      })),
    )

    await putSession(session)

    return success({ sessionId, uploadUrls, websocketUrl }, 201)
  } catch (err) {
    console.error('session-create failed:', err)
    return error('Internal server error', 500)
  }
}

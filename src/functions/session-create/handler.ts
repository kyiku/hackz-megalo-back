import type { APIGatewayProxyHandler } from 'aws-lambda'
import { randomUUID } from 'node:crypto'
import { CreateSessionSchema } from '../../utils/validation'
import { putSession, getSessionByDownloadCode } from '../../lib/dynamodb'
import { generatePresignedUploadUrl } from '../../lib/s3'
import { success, error } from '../../utils/response'
import type { Session } from '../../lib/types'

const TTL_DAYS = 30
const MAX_CODE_RETRIES = 10

/** Generate a zero-padded 5-digit download code (00000–99999). */
const generateDownloadCode = (): string =>
  String(Math.floor(Math.random() * 100000)).padStart(5, '0')

/** Find an unused 5-digit download code, retrying on collisions. */
const findUniqueDownloadCode = async (): Promise<string | null> => {
  for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
    const candidate = generateDownloadCode()
    const existing = await getSessionByDownloadCode(candidate)
    if (!existing) return candidate
  }
  return null
}

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

    const downloadCode = await findUniqueDownloadCode()
    if (!downloadCode) {
      console.error('Failed to generate unique downloadCode after retries')
      return error('Service temporarily unavailable', 503)
    }

    const session: Session = {
      sessionId,
      createdAt: now.toISOString(),
      filterType,
      filter,
      status: 'uploading',
      photoCount,
      downloadCode,
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

    return success({ sessionId, downloadCode, uploadUrls, websocketUrl }, 201)
  } catch (err) {
    console.error('session-create failed:', err)
    return error('Internal server error', 500)
  }
}

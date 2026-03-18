import type { APIGatewayProxyHandler } from 'aws-lambda'
import { updateConnection } from '../../lib/dynamodb'
import { SubscribeSchema } from '../../utils/validation'

export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId
  if (!connectionId) {
    return { statusCode: 400, body: 'Missing connectionId' }
  }

  try {
    const body = JSON.parse(event.body ?? '{}') as Record<string, unknown>
    const parsed = SubscribeSchema.safeParse(body.data)
    if (!parsed.success) {
      return { statusCode: 400, body: parsed.error.message }
    }

    await updateConnection(connectionId, { sessionId: parsed.data.sessionId })

    return { statusCode: 200, body: 'Subscribed' }
  } catch (err) {
    console.error('[ws-subscribe] handler error:', err)
    return { statusCode: 500, body: 'Internal server error' }
  }
}

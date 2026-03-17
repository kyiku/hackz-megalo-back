import type { APIGatewayProxyHandler } from 'aws-lambda'
import { queryConnectionsByRoomId } from '../../lib/dynamodb'
import { sendToConnection } from '../../lib/websocket'
import { ShootingSyncSchema } from '../../utils/validation'

export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId
  if (!connectionId) {
    return { statusCode: 400, body: 'Missing connectionId' }
  }

  try {
    const body = JSON.parse(event.body ?? '{}') as Record<string, unknown>
    const parsed = ShootingSyncSchema.safeParse(body.data)
    if (!parsed.success) {
      return { statusCode: 400, body: parsed.error.message }
    }

    const { roomId, ...eventData } = parsed.data

    const connections = await queryConnectionsByRoomId(roomId)
    const others = connections.filter((c) => c.connectionId !== connectionId)

    await Promise.all(
      others.map((c) =>
        sendToConnection(c.connectionId, {
          type: 'shooting_sync',
          data: eventData,
        }),
      ),
    )

    return { statusCode: 200, body: 'OK' }
  } catch {
    return { statusCode: 500, body: 'Internal server error' }
  }
}

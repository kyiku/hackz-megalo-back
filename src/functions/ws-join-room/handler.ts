import type { APIGatewayProxyHandler } from 'aws-lambda'
import { updateConnection } from '../../lib/dynamodb'
import { JoinRoomSchema } from '../../utils/validation'

export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId
  if (!connectionId) {
    return { statusCode: 400, body: 'Missing connectionId' }
  }

  try {
    const body = JSON.parse(event.body ?? '{}') as Record<string, unknown>
    const parsed = JoinRoomSchema.safeParse(body.data)
    if (!parsed.success) {
      return { statusCode: 400, body: parsed.error.message }
    }

    await updateConnection(connectionId, {
      roomId: parsed.data.roomId,
      role: parsed.data.role,
    })

    return { statusCode: 200, body: 'Joined' }
  } catch {
    return { statusCode: 500, body: 'Internal server error' }
  }
}

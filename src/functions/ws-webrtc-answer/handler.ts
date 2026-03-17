import type { APIGatewayProxyHandler } from 'aws-lambda'
import { queryConnectionsByRoomId } from '../../lib/dynamodb'
import { sendToConnection } from '../../lib/websocket'
import { WebrtcSdpSchema } from '../../utils/validation'

export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId
  if (!connectionId) {
    return { statusCode: 400, body: 'Missing connectionId' }
  }

  try {
    const body = JSON.parse(event.body ?? '{}') as Record<string, unknown>
    const parsed = WebrtcSdpSchema.safeParse(body.data)
    if (!parsed.success) {
      return { statusCode: 400, body: parsed.error.message }
    }

    const connections = await queryConnectionsByRoomId(parsed.data.roomId)
    const others = connections.filter((c) => c.connectionId !== connectionId)

    await Promise.all(
      others.map((c) =>
        sendToConnection(c.connectionId, {
          type: 'webrtc_answer',
          data: { sdp: parsed.data.sdp },
        }),
      ),
    )

    return { statusCode: 200, body: 'OK' }
  } catch {
    return { statusCode: 500, body: 'Internal server error' }
  }
}

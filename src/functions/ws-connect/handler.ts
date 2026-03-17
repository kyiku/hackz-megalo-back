import type { APIGatewayProxyHandler } from 'aws-lambda'
import { putConnection } from '../../lib/dynamodb'
import type { Connection } from '../../lib/types'

export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId
  if (!connectionId) {
    return { statusCode: 400, body: 'Missing connectionId' }
  }

  try {
    const now = Date.now()
    const connection: Connection = {
      connectionId,
      connectedAt: now,
      ttl: Math.floor(now / 1000) + 86400,
    }

    await putConnection(connection)

    return { statusCode: 200, body: 'Connected' }
  } catch {
    return { statusCode: 500, body: 'Internal server error' }
  }
}

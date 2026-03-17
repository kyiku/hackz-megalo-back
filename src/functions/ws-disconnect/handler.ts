import type { APIGatewayProxyHandler } from 'aws-lambda'
import { deleteConnection } from '../../lib/dynamodb'

export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId
  if (!connectionId) {
    return { statusCode: 400, body: 'Missing connectionId' }
  }

  try {
    await deleteConnection(connectionId)
    return { statusCode: 200, body: 'Disconnected' }
  } catch {
    return { statusCode: 500, body: 'Internal server error' }
  }
}

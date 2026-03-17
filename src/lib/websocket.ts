import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi'
import { queryConnectionsBySessionId, deleteConnection } from './dynamodb'

const getEndpoint = (): string => {
  const url = process.env.WEBSOCKET_URL
  if (!url) throw new Error('WEBSOCKET_URL is not set')
  // Convert wss://xxx.execute-api.region.amazonaws.com/stage
  // to https://xxx.execute-api.region.amazonaws.com/stage
  return url.replace('wss://', 'https://')
}

let cachedClient: ApiGatewayManagementApiClient | undefined

const getClient = (): ApiGatewayManagementApiClient => {
  cachedClient ??= new ApiGatewayManagementApiClient({ endpoint: getEndpoint() })
  return cachedClient
}

/** Send a JSON payload to a specific connection. */
export const sendToConnection = async (
  connectionId: string,
  payload: unknown,
): Promise<void> => {
  const client = getClient()
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    )
  } catch (error) {
    if (error instanceof GoneException) {
      // Connection is stale — clean up
      await deleteConnection(connectionId)
      return
    }
    throw error
  }
}

/** Send a JSON payload to all connections subscribed to a session. */
export const sendToSession = async (
  sessionId: string,
  payload: unknown,
): Promise<void> => {
  const connections = await queryConnectionsBySessionId(sessionId)
  await Promise.all(
    connections.map((conn) => sendToConnection(conn.connectionId, payload)),
  )
}

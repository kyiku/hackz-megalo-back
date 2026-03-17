import type { APIGatewayProxyHandler } from 'aws-lambda'
import { getSession } from '../../lib/dynamodb'
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

    return success(session)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return error(message, 500)
  }
}

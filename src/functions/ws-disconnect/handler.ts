import type { APIGatewayProxyHandler } from 'aws-lambda'

export const handler: APIGatewayProxyHandler = async (_event) => {
  await Promise.resolve()
  return { statusCode: 200, body: 'OK' }
}

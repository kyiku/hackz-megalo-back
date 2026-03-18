import type { APIGatewayProxyHandler } from 'aws-lambda'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { getSession } from '../../lib/dynamodb'
import { success, error } from '../../utils/response'

const lambda = new LambdaClient({})

export const handler: APIGatewayProxyHandler = async (event) => {
  const sessionId = event.pathParameters?.sessionId
  if (!sessionId) return error('sessionId is required', 400)

  const bucket = process.env.S3_BUCKET
  if (!bucket) return error('Service configuration error', 500)

  const fastFn = process.env.YAJI_FAST_FUNCTION_NAME
  const deepFn = process.env.YAJI_DEEP_FUNCTION_NAME
  if (!fastFn || !deepFn) return error('Service configuration error', 500)

  const session = await getSession(sessionId)
  if (!session) return error('Session not found', 404)

  const images = Array.from(
    { length: session.photoCount },
    (_, i) => `originals/${sessionId}/${String(i + 1)}.jpg`,
  )

  const payload = JSON.stringify({ sessionId, bucket, images })
  const payloadBytes = new TextEncoder().encode(payload)

  // Fire-and-forget: invoke both Lambdas async in parallel
  await Promise.all([
    lambda.send(new InvokeCommand({
      FunctionName: fastFn,
      InvocationType: 'Event',
      Payload: payloadBytes,
    })),
    lambda.send(new InvokeCommand({
      FunctionName: deepFn,
      InvocationType: 'Event',
      Payload: payloadBytes,
    })),
  ])

  return success({ sessionId, status: 'triggered' }, 202)
}

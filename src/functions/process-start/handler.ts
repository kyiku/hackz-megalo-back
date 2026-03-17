import type { APIGatewayProxyHandler } from 'aws-lambda'
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn'
import { getSession, updateSession } from '../../lib/dynamodb'
import { success, error } from '../../utils/response'
import type { PipelineInput } from '../../lib/types'

const sfn = new SFNClient({})

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const stateMachineArn = process.env.STATE_MACHINE_ARN
    if (!stateMachineArn) {
      console.error('Missing required configuration: STATE_MACHINE_ARN')
      return error('Service configuration error', 500)
    }

    const bucket = process.env.S3_BUCKET
    if (!bucket) {
      console.error('Missing required configuration: S3_BUCKET')
      return error('Service configuration error', 500)
    }

    const sessionId = event.pathParameters?.sessionId
    if (!sessionId) {
      return error('sessionId is required', 400)
    }

    const session = await getSession(sessionId)
    if (!session) {
      return error('Session not found', 404)
    }

    if (session.status !== 'uploading') {
      return error('Session is not in uploading status', 409)
    }

    await updateSession(sessionId, session.createdAt, { status: 'processing' })

    const images = Array.from(
      { length: session.photoCount },
      (_, i) => `originals/${sessionId}/${String(i + 1)}.jpg`,
    )

    const input: PipelineInput = {
      sessionId,
      createdAt: session.createdAt,
      filterType: session.filterType,
      filter: session.filter,
      images,
      bucket,
    }

    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn,
        input: JSON.stringify(input),
      }),
    )

    return success({ sessionId, status: 'processing' }, 202)
  } catch (err) {
    console.error('process-start failed:', err)
    return error('Internal server error', 500)
  }
}

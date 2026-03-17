import { updateSession } from '../../lib/dynamodb'
import { sendToSession } from '../../lib/websocket'

interface PipelineErrorInput {
  readonly sessionId?: string
  readonly createdAt?: string
  readonly error?: unknown
}

export const handler = async (event: PipelineErrorInput): Promise<void> => {
  const { sessionId, createdAt } = event

  if (!sessionId || !createdAt) {
    console.error('pipeline-error: missing sessionId or createdAt', event)
    return
  }

  // Update session status to failed
  try {
    await updateSession(sessionId, createdAt, { status: 'failed' })
  } catch (err) {
    console.error('pipeline-error: failed to update session:', err)
  }

  // Notify via WebSocket
  try {
    await sendToSession(sessionId, {
      type: 'error',
      data: {
        sessionId,
        message: '処理中にエラーが発生しました',
      },
    })
  } catch (err) {
    console.error('pipeline-error: failed to send WebSocket error:', err)
  }
}

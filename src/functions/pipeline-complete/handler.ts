import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane'
import { updateSession } from '../../lib/dynamodb'
import { generatePresignedDownloadUrl } from '../../lib/s3'
import { sendToSession } from '../../lib/websocket'
import type { PipelineInput } from '../../lib/types'

const iot = new IoTDataPlaneClient({})

interface PipelineCompleteInput extends PipelineInput {
  readonly filteredImages: readonly string[]
  readonly collageKey: string
  readonly downloadKey: string
  readonly printKey: string
}

interface PipelineCompleteOutput extends PipelineCompleteInput {
  readonly status: 'completed'
}

export const handler = async (
  event: PipelineCompleteInput,
): Promise<PipelineCompleteOutput> => {
  const { sessionId, createdAt, collageKey, downloadKey, printKey } = event

  // Publish print job to IoT Core
  const iotEndpoint = process.env.IOT_ENDPOINT
  if (iotEndpoint) {
    await iot.send(
      new PublishCommand({
        topic: `receipt-purikura/print/${sessionId}`,
        qos: 1,
        payload: new TextEncoder().encode(
          JSON.stringify({
            sessionId,
            imageKey: printKey,
            format: 'png',
            width: 576,
            timestamp: Math.floor(Date.now() / 1000),
          }),
        ),
      }),
    )
  }

  // Update session status
  await updateSession(sessionId, createdAt, {
    status: 'completed',
    printImageKey: printKey,
    collageImageKey: collageKey,
    downloadKey,
  })

  // Notify via WebSocket with presigned URL
  const collageImageUrl = await generatePresignedDownloadUrl(downloadKey, 3600)
  await sendToSession(sessionId, {
    type: 'completed',
    data: {
      sessionId,
      collageImageUrl,
    },
  })

  return { ...event, status: 'completed' }
}

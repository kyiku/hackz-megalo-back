import { RekognitionClient, DetectFacesCommand } from '@aws-sdk/client-rekognition'
import { sendToSession } from '../../lib/websocket'
import type { PipelineInput, ProgressEvent } from '../../lib/types'

const rekognition = new RekognitionClient({})

interface FaceResult {
  readonly imageKey: string
  readonly details: readonly {
    readonly boundingBox: {
      readonly width: number
      readonly height: number
      readonly left: number
      readonly top: number
    }
    readonly emotions: readonly { readonly type: string; readonly confidence: number }[]
    readonly confidence: number
  }[]
}

interface FaceDetectionOutput extends PipelineInput {
  readonly faces: readonly FaceResult[]
}

const notify = async (sessionId: string, progress: number, message: string): Promise<void> => {
  const event: ProgressEvent = {
    type: 'statusUpdate',
    data: { sessionId, status: 'processing', step: 'face-detection', progress, message },
  }
  await sendToSession(sessionId, event).catch(() => undefined)
}

export const handler = async (event: PipelineInput): Promise<FaceDetectionOutput> => {
  const { sessionId, images, bucket } = event

  await notify(sessionId, 5, '顔を検出中...')

  const faces = await Promise.all(
    images.map(async (imageKey) => {
      const response = await rekognition.send(
        new DetectFacesCommand({
          Image: {
            S3Object: { Bucket: bucket, Name: imageKey },
          },
          Attributes: ['ALL'],
        }),
      )

      const details = (response.FaceDetails ?? []).map((face) => ({
        boundingBox: {
          width: face.BoundingBox?.Width ?? 0,
          height: face.BoundingBox?.Height ?? 0,
          left: face.BoundingBox?.Left ?? 0,
          top: face.BoundingBox?.Top ?? 0,
        },
        emotions: (face.Emotions ?? []).map((e) => ({
          type: e.Type ?? 'UNKNOWN',
          confidence: e.Confidence ?? 0,
        })),
        confidence: face.Confidence ?? 0,
      }))

      return { imageKey, details }
    }),
  )

  return { ...event, faces }
}

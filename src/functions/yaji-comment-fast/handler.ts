import { RekognitionClient, DetectFacesCommand } from '@aws-sdk/client-rekognition'
import { sendToSession } from '../../lib/websocket'

const rekognition = new RekognitionClient({})

const EMOTION_TEMPLATES: Record<string, readonly string[]> = {
  HAPPY: ['いい笑顔ｗｗｗ', '楽しそう！', 'ニコニコだね😊', 'ハッピーオーラ全開！'],
  SAD: ['泣かないで…', 'どうしたの？', '元気出して！'],
  ANGRY: ['怒ってる？ｗ', 'こわいこわい', '落ち着いてｗ'],
  CONFUSED: ['困ってる？ｗ', '何があった？', '大丈夫？'],
  DISGUSTED: ['その顔ｗｗ', 'どうしたのｗ'],
  SURPRISED: ['びっくり！', 'マジか！', 'えっ！？'],
  CALM: ['落ち着いてるね', 'クールだね', '余裕の表情'],
  FEAR: ['こわい？', 'だいじょうぶ！', 'びびってる？ｗ'],
}

interface YajiInput {
  readonly sessionId: string
  readonly bucket: string
  readonly images: readonly string[]
}

// EventBridge S3 Object Created event (yaji-frames/{sessionId}/{timestamp}.jpg)
interface EventBridgeS3Event {
  readonly source: 'aws.s3'
  readonly detail: {
    readonly bucket: { readonly name: string }
    readonly object: { readonly key: string }
  }
}

type HandlerInput = YajiInput | EventBridgeS3Event

const isEventBridge = (e: HandlerInput): e is EventBridgeS3Event =>
  'source' in e

export const handler = async (event: HandlerInput): Promise<void> => {
  let sessionId: string
  let bucket: string
  let imageKey: string

  if (isEventBridge(event)) {
    bucket = event.detail.bucket.name
    imageKey = event.detail.object.key
    // key format: yaji-frames/{sessionId}/{timestamp}.jpg
    sessionId = imageKey.split('/')[1] ?? ''
    if (!sessionId) return
  } else {
    const firstImage = event.images[0]
    if (!firstImage) return
    sessionId = event.sessionId
    bucket = event.bucket
    imageKey = firstImage
  }

  const response = await rekognition.send(
    new DetectFacesCommand({
      Image: { S3Object: { Bucket: bucket, Name: imageKey } },
      Attributes: ['ALL'],
    }),
  )

  const faces = response.FaceDetails ?? []
  if (faces.length === 0) return

  const topEmotion = [...(faces[0]?.Emotions ?? [])].sort(
    (a, b) => (b.Confidence ?? 0) - (a.Confidence ?? 0),
  )[0]

  if (!topEmotion?.Type) return

  const templates = EMOTION_TEMPLATES[topEmotion.Type] ?? EMOTION_TEMPLATES.CALM
  if (!templates || templates.length === 0) return

  const text = templates[Math.floor(Math.random() * templates.length)]
  if (!text) return

  await sendToSession(sessionId, {
    type: 'yajiComment',
    data: {
      text,
      emotion: topEmotion.Type,
      lane: 'fast',
      timestamp: Math.floor(Date.now() / 1000),
    },
  })
}

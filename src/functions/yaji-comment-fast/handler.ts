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

export const handler = async (event: YajiInput): Promise<YajiInput> => {
  const { sessionId, bucket, images } = event

  const firstImage = images[0]
  if (!firstImage) return event

  const response = await rekognition.send(
    new DetectFacesCommand({
      Image: { S3Object: { Bucket: bucket, Name: firstImage } },
      Attributes: ['ALL'],
    }),
  )

  const faces = response.FaceDetails ?? []
  if (faces.length === 0) return event

  const topEmotion = faces[0]?.Emotions?.sort(
    (a, b) => (b.Confidence ?? 0) - (a.Confidence ?? 0),
  )[0]

  if (!topEmotion?.Type) return event

  const templates = EMOTION_TEMPLATES[topEmotion.Type] ?? EMOTION_TEMPLATES.CALM
  if (!templates || templates.length === 0) return event

  const text = templates[Math.floor(Math.random() * templates.length)]
  if (!text) return event

  await sendToSession(sessionId, {
    type: 'yajiComment',
    data: {
      text,
      emotion: topEmotion.Type,
      lane: 'fast',
      timestamp: Math.floor(Date.now() / 1000),
    },
  })

  return event
}

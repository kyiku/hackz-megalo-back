import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { getObject } from '../../lib/s3'
import { sendToSession } from '../../lib/websocket'

const bedrock = new BedrockRuntimeClient({})

interface YajiInput {
  readonly sessionId: string
  readonly bucket: string
  readonly images: readonly string[]
}

interface BedrockResponse {
  readonly content: readonly { readonly text: string }[]
}

export const handler = async (event: YajiInput): Promise<YajiInput> => {
  const { sessionId, images } = event

  const firstImage = images[0]
  if (!firstImage) return event

  try {
    const imageBuffer = await getObject(firstImage)
    const base64Image = imageBuffer.toString('base64')

    const response = await bedrock.send(
      new InvokeModelCommand({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 50,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: base64Image,
                  },
                },
                {
                  type: 'text',
                  text: 'この写真の人にニコニコ動画風のやじコメントを1つだけ書いてください。短く面白く、ネットスラング可。',
                },
              ],
            },
          ],
        }),
      }),
    )

    const body = JSON.parse(
      new TextDecoder().decode(response.body),
    ) as BedrockResponse
    const text = body.content[0]?.text ?? ''

    if (text) {
      await sendToSession(sessionId, {
        type: 'yajiComment',
        data: {
          text,
          emotion: 'deep',
          lane: 'deep',
          timestamp: Math.floor(Date.now() / 1000),
        },
      })
    }
  } catch (err) {
    console.error('yaji-comment-deep Bedrock invocation failed:', err)
  }

  return event
}

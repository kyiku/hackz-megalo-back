import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { ComprehendClient, DetectSentimentCommand } from '@aws-sdk/client-comprehend'
import { getObject } from '../../lib/s3'
import { updateSession } from '../../lib/dynamodb'
import { sendToSession } from '../../lib/websocket'
import type { PipelineInput, ProgressEvent } from '../../lib/types'

const bedrock = new BedrockRuntimeClient({})
const comprehend = new ComprehendClient({})

interface CaptionInput extends PipelineInput {
  readonly filteredImages: readonly string[]
  readonly collageKey: string
}

interface CaptionOutput extends CaptionInput {
  readonly caption: string
  readonly sentiment: string
  readonly sentimentScore: number
}

interface BedrockResponse {
  readonly content: readonly { readonly text: string }[]
}

const notify = async (sessionId: string, progress: number, message: string): Promise<void> => {
  const event: ProgressEvent = {
    type: 'statusUpdate',
    data: { sessionId, status: 'processing', step: 'caption-generate', progress, message },
  }
  await sendToSession(sessionId, event).catch(() => undefined)
}

export const handler = async (event: CaptionInput): Promise<CaptionOutput> => {
  const { sessionId, createdAt, collageKey } = event

  await notify(sessionId, 55, 'キャプション生成中...')

  // Get collage image for Bedrock
  const imageBuffer = await getObject(collageKey)
  const base64Image = imageBuffer.toString('base64')

  // Generate caption with Bedrock Claude
  let caption = ''
  try {
    const bedrockResponse = await bedrock.send(
      new InvokeModelCommand({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 100,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: base64Image,
                  },
                },
                {
                  type: 'text',
                  text: 'この写真に短い日本語キャプションをつけてください。楽しく、ポップな雰囲気で1文でお願いします。',
                },
              ],
            },
          ],
        }),
      }),
    )

    const bedrockBody = JSON.parse(
      new TextDecoder().decode(bedrockResponse.body),
    ) as BedrockResponse
    caption = bedrockBody.content[0]?.text ?? ''
  } catch (err) {
    console.error('Bedrock caption generation failed:', err)
  }

  // Sentiment analysis with Comprehend (skip if no caption)
  let sentiment = 'NEUTRAL'
  let sentimentScore = 0
  if (caption) {
    try {
      const sentimentResponse = await comprehend.send(
        new DetectSentimentCommand({
          Text: caption,
          LanguageCode: 'ja',
        }),
      )
      sentiment = sentimentResponse.Sentiment ?? 'NEUTRAL'
      sentimentScore = sentimentResponse.SentimentScore?.Positive ?? 0
    } catch (err) {
      console.error('Comprehend sentiment analysis failed:', err)
    }
  }

  // Update session
  await updateSession(sessionId, createdAt, {
    caption,
    sentiment,
    sentimentScore,
  })

  return { ...event, caption, sentiment, sentimentScore }
}

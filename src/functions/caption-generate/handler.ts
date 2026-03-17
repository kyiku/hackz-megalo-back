import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { ComprehendClient, DetectSentimentCommand } from '@aws-sdk/client-comprehend'
import { getObject } from '../../lib/s3'
import { updateSession } from '../../lib/dynamodb'
import type { PipelineInput } from '../../lib/types'

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

export const handler = async (event: CaptionInput): Promise<CaptionOutput> => {
  const { sessionId, createdAt, collageKey } = event

  // Get collage image for Bedrock
  const imageBuffer = await getObject(collageKey)
  const base64Image = imageBuffer.toString('base64')

  // Generate caption with Bedrock Claude
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
  const caption = bedrockBody.content[0]?.text ?? ''

  // Sentiment analysis with Comprehend
  const sentimentResponse = await comprehend.send(
    new DetectSentimentCommand({
      Text: caption,
      LanguageCode: 'ja',
    }),
  )

  const sentiment = sentimentResponse.Sentiment ?? 'NEUTRAL'
  const scores = sentimentResponse.SentimentScore
  const sentimentScore = scores?.Positive ?? 0

  // Update session
  await updateSession(sessionId, createdAt, {
    caption,
    sentiment,
    sentimentScore,
  })

  return { ...event, caption, sentiment, sentimentScore }
}

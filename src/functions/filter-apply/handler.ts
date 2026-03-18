import sharp from 'sharp'
import pLimit from 'p-limit'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { getObject, putObject } from '../../lib/s3'
import { sendToSession } from '../../lib/websocket'
import type { PipelineInput, Filter, AiFilter, ProgressEvent } from '../../lib/types'

interface FilterApplyOutput extends PipelineInput {
  readonly filteredImages: readonly string[]
}

const bedrock = new BedrockRuntimeClient({})

/**
 * Limit concurrent AI pipeline runs (getObject → Bedrock → putObject) to 2.
 * Avoids Stability AI throttling and excessive Lambda memory from large images.
 */
const bedrockLimit = pLimit(2)

const applySimpleFilter = (pipeline: sharp.Sharp, filter: Filter): sharp.Sharp => {
  switch (filter) {
    case 'natural':
      return pipeline
    case 'beauty':
      return pipeline.blur(1.5).sharpen()
    case 'bright':
      return pipeline.modulate({ brightness: 1.2 }).linear(1.1, 0)
    case 'mono':
      return pipeline.greyscale()
    case 'sepia':
      return pipeline.greyscale().tint({ r: 112, g: 66, b: 20 })
    default:
      return pipeline
  }
}

const notify = async (sessionId: string, progress: number, message: string): Promise<void> => {
  const event: ProgressEvent = {
    type: 'statusUpdate',
    data: { sessionId, status: 'processing', step: 'filter', progress, message },
  }
  await sendToSession(sessionId, event).catch(() => undefined)
}

/**
 * Prompts for each AI filter style.
 * Used by stable-image-core-v1 image-to-image mode.
 */
const AI_PROMPTS: Record<AiFilter, string> = {
  anime: 'anime style illustration, vibrant colors, cel shading, studio ghibli',
  popart: 'pop art style, bold outlines, halftone dots, vivid flat colors, Andy Warhol',
  watercolor: 'watercolor painting, soft wet brushstrokes, artistic, flowing pastel colors',
}

/**
 * Image-to-image strength (0.0–1.0).
 * Higher = stronger style transformation, lower = closer to original.
 */
const AI_STRENGTH = 0.8

interface StabilityResponse {
  readonly images: readonly string[]
}

/**
 * Apply AI style transfer via Stability AI stable-image-core on Bedrock.
 * Uses image-to-image mode — no external style reference images required.
 */
const applyAiFilter = async (imageBuffer: Buffer, filter: AiFilter): Promise<Buffer> => {
  const base64Image = imageBuffer.toString('base64')

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: 'us.stability.stable-image-core-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        prompt: AI_PROMPTS[filter],
        image: base64Image,
        mode: 'image-to-image',
        strength: AI_STRENGTH,
        output_format: 'png',
      }),
    }),
  )

  const body = JSON.parse(
    new TextDecoder().decode(response.body),
  ) as StabilityResponse

  const outputBase64 = body.images[0]
  if (!outputBase64) throw new Error('Stability AI returned no images')

  return Buffer.from(outputBase64, 'base64')
}

const isAiFilter = (filter: Filter): filter is AiFilter =>
  filter === 'anime' || filter === 'popart' || filter === 'watercolor'

export const handler = async (event: PipelineInput): Promise<FilterApplyOutput> => {
  const { sessionId, filter, filterType, images } = event

  await notify(sessionId, 10, 'フィルター適用中...')

  const isAi = filterType === 'ai' && isAiFilter(filter)

  const filteredImages = await Promise.all(
    images.map((imageKey, i) => {
      const processImage = async (): Promise<string> => {
        const imageBuffer = await getObject(imageKey)

        const outputBuffer = isAi
          ? await applyAiFilter(imageBuffer, filter as AiFilter)
          : await applySimpleFilter(sharp(imageBuffer), filter).png().toBuffer()

        const outputKey = `filtered/${sessionId}/${String(i + 1)}.png`
        await putObject(outputKey, outputBuffer)
        return outputKey
      }

      // For AI filters: limit entire pipeline (S3 read → Bedrock → S3 write) to 2 concurrent.
      // For simple filters: no concurrency limit needed (no Bedrock involved).
      return isAi ? bedrockLimit(processImage) : processImage()
    }),
  )

  await notify(sessionId, 30, 'フィルター適用完了')

  return { ...event, filteredImages }
}

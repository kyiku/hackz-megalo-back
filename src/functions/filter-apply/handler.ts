import sharp from 'sharp'
import pLimit from 'p-limit'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { getObject, putObject } from '../../lib/s3'
import { sendToSession } from '../../lib/websocket'
import type { PipelineInput, Filter, AiFilter, ProgressEvent } from '../../lib/types'

interface FilterApplyOutput extends PipelineInput {
  readonly filteredImages: readonly string[]
}

const bedrock = new BedrockRuntimeClient({ region: 'us-west-2' })

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

/** Per-filter prompt and strength for SD3.5 img2img. */
const AI_FILTER_CONFIG: Record<AiFilter, {
  readonly prompt: string
  readonly strength: number
}> = {
  anime: {
    prompt: 'anime style illustration, vibrant colors, cel shading, clean lines, studio ghibli aesthetic',
    strength: 0.65,
  },
  popart: {
    prompt: 'pop art style, bold flat colors, halftone dots, thick black outlines, Andy Warhol aesthetic, comic book',
    strength: 0.70,
  },
  watercolor: {
    prompt: 'watercolor painting, soft wet brushstrokes, pastel colors, artistic, flowing paint, paper texture',
    strength: 0.60,
  },
}

interface StabilityResponse {
  readonly images: readonly string[]
}

/** Apply AI style via Stable Diffusion 3.5 img2img on Bedrock (us-west-2). */
const applyAiFilter = async (imageBuffer: Buffer, filter: AiFilter): Promise<Buffer> => {
  const config = AI_FILTER_CONFIG[filter]

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: 'stability.sd3-5-large-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        prompt: config.prompt,
        image: imageBuffer.toString('base64'),
        mode: 'image-to-image',
        strength: config.strength,
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

  const filteredImages = await Promise.all(
    images.map((imageKey, i) =>
      bedrockLimit(async () => {
        const imageBuffer = await getObject(imageKey)

        const outputBuffer = (filterType === 'ai' && isAiFilter(filter))
          ? await applyAiFilter(imageBuffer, filter)
          : await applySimpleFilter(sharp(imageBuffer), filter).png().toBuffer()

        const outputKey = `filtered/${sessionId}/${String(i + 1)}.png`
        await putObject(outputKey, outputBuffer)
        return outputKey
      }),
    ),
  )

  await notify(sessionId, 30, 'フィルター適用完了')

  return { ...event, filteredImages }
}

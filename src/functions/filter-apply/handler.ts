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

interface StyleParams {
  readonly compositionFidelity: number
  readonly styleStrength: number
  readonly changeStrength: number
}

/**
 * Per-filter tuning for stable-style-transfer-v1:0.
 * composition_fidelity: how much to preserve original composition (0.0–1.0)
 * style_strength: how strongly to apply style (0.0–1.0)
 * change_strength: overall transformation intensity (0.0–1.0)
 */
const AI_STYLE_PARAMS: Record<AiFilter, StyleParams> = {
  anime: { compositionFidelity: 0.9, styleStrength: 0.9, changeStrength: 0.9 },
  popart: { compositionFidelity: 0.85, styleStrength: 0.95, changeStrength: 0.9 },
  watercolor: { compositionFidelity: 0.9, styleStrength: 0.85, changeStrength: 0.8 },
}

interface StabilityResponse {
  readonly images: readonly string[]
}

/** Fetch style reference image from S3. */
const fetchStyleBuffer = async (filter: AiFilter): Promise<Buffer> =>
  getObject(`style-references/${filter}.jpg`)

/**
 * Apply AI style transfer via Stability AI stable-style-transfer-v1:0 on Bedrock.
 * Uses init_image (user photo) + style_image (S3 reference) for image-to-image style transfer.
 */
const applyAiFilter = async (imageBuffer: Buffer, filter: AiFilter): Promise<Buffer> => {
  const [styleBuffer] = await Promise.all([fetchStyleBuffer(filter)])
  const initImage = imageBuffer.toString('base64')
  const styleImage = styleBuffer.toString('base64')
  const { compositionFidelity, styleStrength, changeStrength } = AI_STYLE_PARAMS[filter]

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: 'us.stability.stable-style-transfer-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        init_image: initImage,
        style_image: styleImage,
        composition_fidelity: compositionFidelity,
        style_strength: styleStrength,
        change_strength: changeStrength,
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
          ? await applyAiFilter(imageBuffer, filter)
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

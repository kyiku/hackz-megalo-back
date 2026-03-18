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

/** Per-filter style transfer parameters (Stability AI Style Transfer). */
const AI_STYLE_PARAMS: Record<AiFilter, {
  readonly style_strength: number
  readonly composition_fidelity: number
  readonly change_strength: number
}> = {
  anime:      { style_strength: 0.90, composition_fidelity: 0.85, change_strength: 0.85 },
  popart:     { style_strength: 0.95, composition_fidelity: 0.80, change_strength: 0.90 },
  watercolor: { style_strength: 0.85, composition_fidelity: 0.90, change_strength: 0.80 },
}

interface StabilityResponse {
  readonly images: readonly string[]
}

/** Apply AI style transfer via Stability AI Style Transfer on Bedrock (us-west-2). */
const applyAiFilter = async (imageBuffer: Buffer, styleBuffer: Buffer, filter: AiFilter): Promise<Buffer> => {
  const params = AI_STYLE_PARAMS[filter]

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: 'stability.stable-style-transfer-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        image: imageBuffer.toString('base64'),
        style_image: styleBuffer.toString('base64'),
        style_strength: params.style_strength,
        composition_fidelity: params.composition_fidelity,
        change_strength: params.change_strength,
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

/** Fetch style reference image from S3. Falls back to null if missing. */
const fetchStyleBuffer = async (filter: Filter, filterType: string): Promise<Buffer | null> => {
  if (filterType !== 'ai' || !isAiFilter(filter)) return null
  try {
    return await getObject(`style-references/${filter}.jpg`)
  } catch {
    console.warn(`[filter-apply] style-references/${filter}.jpg not found, falling back to simple filter`)
    return null
  }
}

const isAiFilter = (filter: Filter): filter is AiFilter =>
  filter === 'anime' || filter === 'popart' || filter === 'watercolor'

export const handler = async (event: PipelineInput): Promise<FilterApplyOutput> => {
  const { sessionId, filter, filterType, images } = event

  await notify(sessionId, 10, 'フィルター適用中...')

  // スタイル参照画像を1回だけ取得（AI filterの場合）
  const styleBuffer = await fetchStyleBuffer(filter, filterType)

  const filteredImages = await Promise.all(
    images.map((imageKey, i) =>
      bedrockLimit(async () => {
        const imageBuffer = await getObject(imageKey)

        const outputBuffer = (filterType === 'ai' && isAiFilter(filter) && styleBuffer)
          ? await applyAiFilter(imageBuffer, styleBuffer, filter)
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

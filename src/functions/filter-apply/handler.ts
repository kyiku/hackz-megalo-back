import sharp from 'sharp'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { getObject, putObject } from '../../lib/s3'
import { sendToSession } from '../../lib/websocket'
import type { PipelineInput, Filter, AiFilter, ProgressEvent } from '../../lib/types'

interface FilterApplyOutput extends PipelineInput {
  readonly filteredImages: readonly string[]
}

const bedrock = new BedrockRuntimeClient({})

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

/** Per-filter style transfer strength parameters. */
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

/** Apply AI style transfer via Stability AI Style Transfer on Bedrock. */
const applyAiFilter = async (
  imageBuffer: Buffer,
  styleBuffer: Buffer,
  filter: AiFilter,
): Promise<Buffer> => {
  const params = AI_STYLE_PARAMS[filter]

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: 'us.stability.stable-style-transfer-v1:0',
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

const isAiFilter = (filter: Filter): filter is AiFilter =>
  filter === 'anime' || filter === 'popart' || filter === 'watercolor'

export const handler = async (event: PipelineInput): Promise<FilterApplyOutput> => {
  const { sessionId, filter, filterType, images } = event

  await notify(sessionId, 10, 'フィルター適用中...')

  // Fetch style reference image once (reused for all photos in session)
  const styleBuffer = filterType === 'ai' && isAiFilter(filter)
    ? await getObject(`style-references/${filter}.jpg`)
    : null

  const filteredImages = await Promise.all(
    images.map(async (imageKey, i) => {
      const imageBuffer = await getObject(imageKey)

      let outputBuffer: Buffer
      if (filterType === 'ai' && isAiFilter(filter) && styleBuffer) {
        outputBuffer = await applyAiFilter(imageBuffer, styleBuffer, filter)
      } else {
        const pipeline = applySimpleFilter(sharp(imageBuffer), filter)
        outputBuffer = await pipeline.png().toBuffer()
      }

      const outputKey = `filtered/${sessionId}/${String(i + 1)}.png`
      await putObject(outputKey, outputBuffer)
      return outputKey
    }),
  )

  await notify(sessionId, 30, 'フィルター適用完了')

  return { ...event, filteredImages }
}

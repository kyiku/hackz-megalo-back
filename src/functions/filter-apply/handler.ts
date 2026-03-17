import sharp from 'sharp'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { getObject, putObject } from '../../lib/s3'
import type { PipelineInput, Filter, AiFilter } from '../../lib/types'

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

/** Map AI filter names to Stability AI style_preset values. */
const AI_STYLE_PRESETS: Record<AiFilter, string> = {
  anime: 'anime',
  popart: 'comic-book',
  watercolor: 'digital-art',
}

/** Map AI filter names to descriptive prompts. */
const AI_PROMPTS: Record<AiFilter, string> = {
  anime: 'anime style illustration, vibrant colors, cel shading',
  popart: 'pop art style, bold colors, halftone dots, comic book aesthetic',
  watercolor: 'watercolor painting, soft brushstrokes, artistic, flowing colors',
}

interface StabilityResponse {
  readonly images: readonly string[]
}

/** Apply AI style transfer via Stability AI on Bedrock. */
const applyAiFilter = async (imageBuffer: Buffer, filter: AiFilter): Promise<Buffer> => {
  const base64Image = imageBuffer.toString('base64')

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: 'us.stability.stable-image-style-guide-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        image: base64Image,
        prompt: AI_PROMPTS[filter],
        style_preset: AI_STYLE_PRESETS[filter],
        output_format: 'png',
        fidelity: 0.7,
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

  const filteredImages = await Promise.all(
    images.map(async (imageKey, i) => {
      const imageBuffer = await getObject(imageKey)

      let outputBuffer: Buffer
      if (filterType === 'ai' && isAiFilter(filter)) {
        outputBuffer = await applyAiFilter(imageBuffer, filter)
      } else {
        const pipeline = applySimpleFilter(sharp(imageBuffer), filter)
        outputBuffer = await pipeline.png().toBuffer()
      }

      const outputKey = `filtered/${sessionId}/${String(i + 1)}.png`
      await putObject(outputKey, outputBuffer)
      return outputKey
    }),
  )

  return { ...event, filteredImages }
}

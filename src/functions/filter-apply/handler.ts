import sharp from 'sharp'
import { getObject, putObject } from '../../lib/s3'
import type { PipelineInput, Filter } from '../../lib/types'

interface FilterApplyOutput extends PipelineInput {
  readonly filteredImages: readonly string[]
}

const applyFilter = (pipeline: sharp.Sharp, filter: Filter): sharp.Sharp => {
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
    case 'anime':
    case 'popart':
    case 'watercolor':
      return pipeline
  }
}

export const handler = async (event: PipelineInput): Promise<FilterApplyOutput> => {
  const { sessionId, filter, images } = event

  const filteredImages = await Promise.all(
    images.map(async (imageKey, i) => {
      const imageBuffer = await getObject(imageKey)
      const pipeline = applyFilter(sharp(imageBuffer), filter)
      const outputBuffer = await pipeline.png().toBuffer()

      const outputKey = `filtered/${sessionId}/${String(i + 1)}.png`
      await putObject(outputKey, outputBuffer)
      return outputKey
    }),
  )

  return { ...event, filteredImages }
}

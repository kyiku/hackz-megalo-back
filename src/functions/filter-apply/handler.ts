import sharp from 'sharp'
import { getObject, putObject } from '../../lib/s3'
import { sendToSession } from '../../lib/websocket'
import type { PipelineInput, Filter, ProgressEvent } from '../../lib/types'

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

const notify = async (sessionId: string, progress: number, message: string): Promise<void> => {
  const event: ProgressEvent = {
    type: 'statusUpdate',
    data: { sessionId, status: 'processing', step: 'filter-apply', progress, message },
  }
  await sendToSession(sessionId, event).catch(() => undefined)
}

export const handler = async (event: PipelineInput): Promise<FilterApplyOutput> => {
  const { sessionId, filter, images } = event

  await notify(sessionId, 10, 'フィルター適用中...')

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

  await notify(sessionId, 30, 'フィルター適用完了')

  return { ...event, filteredImages }
}

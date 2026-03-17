import sharp from 'sharp'
import { getObject, putObject } from '../../lib/s3'
import type { PipelineInput } from '../../lib/types'

interface CollageInput extends PipelineInput {
  readonly filteredImages: readonly string[]
}

interface CollageOutput extends CollageInput {
  readonly collageKey: string
}

const CANVAS_SIZE = 576
const PADDING = 10
const GAP = 6

const CELL_SIZE = Math.floor((CANVAS_SIZE - PADDING * 2 - GAP) / 2)

const cropToSquare = async (buffer: Buffer): Promise<Buffer> => {
  const image = sharp(buffer)
  const { width, height } = await image.metadata()
  const size = Math.min(width, height)

  return image
    .extract({
      left: Math.floor((width - size) / 2),
      top: Math.floor((height - size) / 2),
      width: size,
      height: size,
    })
    .resize(CELL_SIZE, CELL_SIZE)
    .toBuffer()
}

export const handler = async (event: CollageInput): Promise<CollageOutput> => {
  const { sessionId, filteredImages } = event

  const cellBuffers = await Promise.all(
    filteredImages.map(async (key) => {
      const buffer = await getObject(key)
      return cropToSquare(buffer)
    }),
  )

  const positions: readonly [
    { left: number; top: number },
    { left: number; top: number },
    { left: number; top: number },
    { left: number; top: number },
  ] = [
    { left: PADDING, top: PADDING },
    { left: PADDING + CELL_SIZE + GAP, top: PADDING },
    { left: PADDING, top: PADDING + CELL_SIZE + GAP },
    { left: PADDING + CELL_SIZE + GAP, top: PADDING + CELL_SIZE + GAP },
  ]

  const compositeInputs = [
    { input: cellBuffers[0], left: positions[0].left, top: positions[0].top },
    { input: cellBuffers[1], left: positions[1].left, top: positions[1].top },
    { input: cellBuffers[2], left: positions[2].left, top: positions[2].top },
    { input: cellBuffers[3], left: positions[3].left, top: positions[3].top },
  ]

  const canvas = sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 3 as const,
      background: { r: 255, g: 255, b: 255 },
    },
  })

  const collageBuffer = await canvas.composite(compositeInputs).png().toBuffer()

  const collageKey = `collages/${sessionId}.png`
  await putObject(collageKey, collageBuffer)

  return { ...event, collageKey }
}

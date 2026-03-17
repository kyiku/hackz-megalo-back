import sharp from 'sharp'
import { getObject, putObject } from '../../lib/s3'
import { sendToSession } from '../../lib/websocket'
import type { PipelineInput, ProgressEvent } from '../../lib/types'

interface CollageInput extends PipelineInput {
  readonly filteredImages: readonly string[]
}

interface CollageOutput extends CollageInput {
  readonly collageKey: string
}

const CANVAS_SIZE = 576
const PADDING = 10
const GAP = 6

const CELL_SIZE_2x2 = Math.floor((CANVAS_SIZE - PADDING * 2 - GAP) / 2)

const cropToSquare = async (buffer: Buffer, cellSize: number): Promise<Buffer> => {
  const image = sharp(buffer)
  const { width: w, height: h } = await image.metadata()
  const size = Math.min(w, h)

  return image
    .extract({
      left: Math.floor((w - size) / 2),
      top: Math.floor((h - size) / 2),
      width: size,
      height: size,
    })
    .resize(cellSize, cellSize)
    .toBuffer()
}

const notify = async (sessionId: string, progress: number, message: string): Promise<void> => {
  const event: ProgressEvent = {
    type: 'statusUpdate',
    data: { sessionId, status: 'processing', step: 'collage-generate', progress, message },
  }
  await sendToSession(sessionId, event).catch(() => undefined)
}

/** Get grid positions for 1-4 images. */
const getLayout = (count: number): { cellSize: number; positions: { left: number; top: number }[] } => {
  if (count === 1) {
    const cellSize = CANVAS_SIZE - PADDING * 2
    return { cellSize, positions: [{ left: PADDING, top: PADDING }] }
  }
  if (count === 2) {
    return {
      cellSize: CELL_SIZE_2x2,
      positions: [
        { left: PADDING, top: Math.floor((CANVAS_SIZE - CELL_SIZE_2x2) / 2) },
        { left: PADDING + CELL_SIZE_2x2 + GAP, top: Math.floor((CANVAS_SIZE - CELL_SIZE_2x2) / 2) },
      ],
    }
  }
  if (count === 3) {
    return {
      cellSize: CELL_SIZE_2x2,
      positions: [
        { left: Math.floor((CANVAS_SIZE - CELL_SIZE_2x2) / 2), top: PADDING },
        { left: PADDING, top: PADDING + CELL_SIZE_2x2 + GAP },
        { left: PADDING + CELL_SIZE_2x2 + GAP, top: PADDING + CELL_SIZE_2x2 + GAP },
      ],
    }
  }
  return {
    cellSize: CELL_SIZE_2x2,
    positions: [
      { left: PADDING, top: PADDING },
      { left: PADDING + CELL_SIZE_2x2 + GAP, top: PADDING },
      { left: PADDING, top: PADDING + CELL_SIZE_2x2 + GAP },
      { left: PADDING + CELL_SIZE_2x2 + GAP, top: PADDING + CELL_SIZE_2x2 + GAP },
    ],
  }
}

export const handler = async (event: CollageInput): Promise<CollageOutput> => {
  const { sessionId, filteredImages } = event

  await notify(sessionId, 40, 'コラージュ生成中...')

  const { cellSize, positions } = getLayout(filteredImages.length)

  const cellBuffers = await Promise.all(
    filteredImages.map(async (key) => {
      const buffer = await getObject(key)
      return cropToSquare(buffer, cellSize)
    }),
  )

  const compositeInputs = cellBuffers.map((input, i) => ({
    input,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    left: positions[i]!.left,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    top: positions[i]!.top,
  }))

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

  await notify(sessionId, 50, 'コラージュ生成完了')

  return { ...event, collageKey }
}

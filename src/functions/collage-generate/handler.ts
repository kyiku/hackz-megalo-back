import sharp from 'sharp'
import { getObject, putObject } from '../../lib/s3'
import { sendToSession } from '../../lib/websocket'
import type { PipelineInput, ProgressEvent } from '../../lib/types'

/** Bounding box from face-detection (Rekognition normalized 0-1 values). */
interface FaceBoundingBox {
  readonly width: number
  readonly height: number
  readonly left: number
  readonly top: number
}

interface FaceResult {
  readonly imageKey: string
  readonly details: readonly {
    readonly boundingBox: FaceBoundingBox
    readonly confidence: number
  }[]
}

interface CollageInput extends PipelineInput {
  readonly filteredImages: readonly string[]
  readonly faces?: readonly FaceResult[]
}

interface CollageOutput extends CollageInput {
  readonly collageKey: string
}

const CANVAS_SIZE = 576
const PADDING = 10
const GAP = 6

const CELL_SIZE_2x2 = Math.floor((CANVAS_SIZE - PADDING * 2 - GAP) / 2)

/**
 * Crop to square centered on the primary face.
 * If no face data, falls back to center crop.
 */
const smartCropToSquare = async (
  buffer: Buffer,
  cellSize: number,
  face?: FaceBoundingBox,
): Promise<Buffer> => {
  const image = sharp(buffer)
  const { width: imgW, height: imgH } = await image.metadata()
  const cropSize = Math.min(imgW, imgH)

  let left: number
  let top: number

  if (face) {
    const faceCenterX = Math.round((face.left + face.width / 2) * imgW)
    const faceCenterY = Math.round((face.top + face.height / 2) * imgH)
    left = Math.max(0, Math.min(imgW - cropSize, faceCenterX - Math.floor(cropSize / 2)))
    top = Math.max(0, Math.min(imgH - cropSize, faceCenterY - Math.floor(cropSize / 2)))
  } else {
    left = Math.floor((imgW - cropSize) / 2)
    top = Math.floor((imgH - cropSize) / 2)
  }

  return image
    .extract({ left, top, width: cropSize, height: cropSize })
    .resize(cellSize, cellSize)
    .toBuffer()
}

const notify = async (sessionId: string, progress: number, message: string): Promise<void> => {
  const event: ProgressEvent = {
    type: 'statusUpdate',
    data: { sessionId, status: 'processing', step: 'collage', progress, message },
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

/**
 * Find the primary (highest confidence) face bounding box for a given image index.
 */
const findPrimaryFace = (
  faces: readonly FaceResult[] | undefined,
  imageIndex: number,
): FaceBoundingBox | undefined => {
  if (!faces) return undefined
  const faceResult = faces[imageIndex]
  if (!faceResult || faceResult.details.length === 0) return undefined
  return faceResult.details[0]?.boundingBox
}

export const handler = async (event: CollageInput): Promise<CollageOutput> => {
  const { sessionId, filteredImages, faces } = event

  await notify(sessionId, 40, 'コラージュ生成中...')

  const { cellSize, positions } = getLayout(filteredImages.length)

  const cellBuffers = await Promise.all(
    filteredImages.map(async (key, i) => {
      const buffer = await getObject(key)
      const face = findPrimaryFace(faces, i)
      return smartCropToSquare(buffer, cellSize, face)
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

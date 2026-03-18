import sharp from 'sharp'
import { getObject, putObject } from '../../lib/s3'
import { sendToSession } from '../../lib/websocket'
import type { PipelineInput, ProgressEvent } from '../../lib/types'

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

const CANVAS_WIDTH = 576
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
  if (!imgW || !imgH) throw new Error('Invalid image: missing dimensions')
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

/**
 * Resize image to fit cell dimensions, maintaining aspect ratio.
 * Center-crop to fill the cell, optionally centering on face.
 */
const smartCropToCell = async (
  buffer: Buffer,
  cellWidth: number,
  cellHeight: number,
  face?: FaceBoundingBox,
): Promise<Buffer> => {
  const image = sharp(buffer)
  const meta = await image.metadata()
  const imgW = meta.width ? meta.width : cellWidth
  const imgH = meta.height ? meta.height : cellHeight

  const targetRatio = cellWidth / cellHeight
  const imgRatio = imgW / imgH

  let cropWidth: number
  let cropHeight: number
  let left: number
  let top: number

  if (imgRatio > targetRatio) {
    // Image is wider than target: crop sides
    cropHeight = imgH
    cropWidth = Math.round(imgH * targetRatio)
    top = 0
    if (face) {
      const faceCenterX = Math.round((face.left + face.width / 2) * imgW)
      left = Math.max(0, Math.min(imgW - cropWidth, faceCenterX - Math.floor(cropWidth / 2)))
    } else {
      left = Math.floor((imgW - cropWidth) / 2)
    }
  } else {
    // Image is taller than target: crop top/bottom
    cropWidth = imgW
    cropHeight = Math.round(imgW / targetRatio)
    left = 0
    if (face) {
      const faceCenterY = Math.round((face.top + face.height / 2) * imgH)
      top = Math.max(0, Math.min(imgH - cropHeight, faceCenterY - Math.floor(cropHeight / 2)))
    } else {
      top = Math.floor((imgH - cropHeight) / 2)
    }
  }

  return image
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(cellWidth, cellHeight)
    .toBuffer()
}

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

  // Detect photo orientation from first image
  const firstBuffer = await getObject(filteredImages[0] ?? '')
  const firstMeta = await sharp(firstBuffer).metadata()
  const firstW = firstMeta.width ? firstMeta.width : 1
  const firstH = firstMeta.height ? firstMeta.height : 1
  const photoRatio = firstH / firstW // > 1 = portrait, < 1 = landscape

  // Cell dimensions maintain original photo ratio
  const cellWidth = Math.floor((CANVAS_WIDTH - PADDING * 2 - GAP) / 2)
  const cellHeight = Math.round(cellWidth * photoRatio)

  // Canvas height adapts to photo ratio
  const canvasHeight = cellHeight * 2 + PADDING * 2 + GAP

  const count = filteredImages.length
  let positions: { left: number; top: number }[]

  if (count === 1) {
    const singleWidth = CANVAS_WIDTH - PADDING * 2
    const singleHeight = Math.round(singleWidth * photoRatio)
    positions = [{ left: PADDING, top: PADDING }]
    const cellBuffers = await Promise.all(
      filteredImages.map(async (key) => {
        const buffer = await getObject(key)
        return smartCropToCell(buffer, singleWidth, singleHeight)
      }),
    )
    const canvas = sharp({
      create: {
        width: CANVAS_WIDTH,
        height: singleHeight + PADDING * 2,
        channels: 3 as const,
        background: { r: 255, g: 255, b: 255 },
      },
    })
    const collageBuffer = await canvas
      .composite(cellBuffers.map((input, i) => ({
        input,
        left: positions[i]?.left ?? PADDING,
        top: positions[i]?.top ?? PADDING,
      })))
      .png()
      .toBuffer()
    const collageKey = `collages/${sessionId}.png`
    await putObject(collageKey, collageBuffer)
    await notify(sessionId, 50, 'コラージュ生成完了')
    return { ...event, collageKey }
  }

  // 2x2 layout (for 2, 3, or 4 photos)
  if (count === 2) {
    positions = [
      { left: PADDING, top: Math.floor((canvasHeight - cellHeight) / 2) },
      { left: PADDING + cellWidth + GAP, top: Math.floor((canvasHeight - cellHeight) / 2) },
    ]
  } else if (count === 3) {
    positions = [
      { left: Math.floor((CANVAS_WIDTH - cellWidth) / 2), top: PADDING },
      { left: PADDING, top: PADDING + cellHeight + GAP },
      { left: PADDING + cellWidth + GAP, top: PADDING + cellHeight + GAP },
    ]
  } else {
    positions = [
      { left: PADDING, top: PADDING },
      { left: PADDING + cellWidth + GAP, top: PADDING },
      { left: PADDING, top: PADDING + cellHeight + GAP },
      { left: PADDING + cellWidth + GAP, top: PADDING + cellHeight + GAP },
    ]
  }

  const cellBuffers = await Promise.all(
    filteredImages.map(async (key, i) => {
      const buffer = await getObject(key)
      const face = findPrimaryFace(faces, i)
      return smartCropToCell(buffer, cellWidth, cellHeight, face)
    }),
  )

  const canvas = sharp({
    create: {
      width: CANVAS_WIDTH,
      height: canvasHeight,
      channels: 3 as const,
      background: { r: 255, g: 255, b: 255 },
    },
  })

  const collageBuffer = await canvas
    .composite(cellBuffers.map((input, i) => ({
      input,
      left: positions[i]?.left ?? PADDING,
      top: positions[i]?.top ?? PADDING,
    })))
    .png()
    .toBuffer()

  const collageKey = `collages/${sessionId}.png`
  await putObject(collageKey, collageBuffer)

  await notify(sessionId, 50, 'コラージュ生成完了')

  return { ...event, collageKey }
}

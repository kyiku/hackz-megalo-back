import sharp from 'sharp'
import { getObject, putObject } from '../../lib/s3'
import { sendToSession } from '../../lib/websocket'
import { generateClaycodeSvg } from '../../lib/claycode'
import type { PipelineInput, ProgressEvent } from '../../lib/types'

interface PrintPrepareInput extends PipelineInput {
  readonly filteredImages: readonly string[]
  readonly collageKey: string
  readonly caption?: string
  readonly sentiment?: string
  readonly sentimentScore?: number
}

interface PrintPrepareOutput extends PrintPrepareInput {
  readonly downloadKey: string
  readonly printKey: string
}

const PRINT_WIDTH = 576

/** Floyd-Steinberg dithering on single-channel greyscale pixel data. */
const floydSteinbergDither = (pixels: Uint8Array, width: number, height: number): Uint8Array => {
  const data = new Float32Array(pixels)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounds checked by caller
  const get = (i: number): number => data[i]!
  const add = (i: number, v: number): void => { data[i] = get(i) + v }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const oldPixel = get(idx)
      const newPixel = oldPixel < 128 ? 0 : 255
      data[idx] = newPixel
      const err = oldPixel - newPixel

      if (x + 1 < width) add(idx + 1, err * 7 / 16)
      if (y + 1 < height) {
        if (x > 0) add((y + 1) * width + (x - 1), err * 3 / 16)
        add((y + 1) * width + x, err * 5 / 16)
        if (x + 1 < width) add((y + 1) * width + (x + 1), err * 1 / 16)
      }
    }
  }

  const output = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++) {
    output[i] = Math.max(0, Math.min(255, Math.round(get(i))))
  }
  return output
}

const notify = async (sessionId: string, progress: number, message: string): Promise<void> => {
  const event: ProgressEvent = {
    type: 'statusUpdate',
    data: { sessionId, status: 'processing', step: 'dither', progress, message },
  }
  await sendToSession(sessionId, event).catch(() => undefined)
}

/** Create a text image using sharp's Pango text API (works without Fontconfig). */
const createTextBuffer = async (text: string, width: number, height: number, fontSize: number, color = 'black'): Promise<Buffer> => {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const sizePt = fontSize * 1000
  return sharp({
    text: {
      text: `<span foreground="${color}" size="${String(sizePt)}">${escaped}</span>`,
      rgba: true,
      width,
      height,
      align: 'centre',
    },
  }).png().toBuffer()
}

/** Create receipt header image. */
const createHeaderImage = (width: number): Promise<Buffer> =>
  createTextBuffer('Receipt Purikura', width, 50, 20)

/** Create caption image. */
const createCaptionImage = (text: string, width: number): Promise<Buffer> =>
  createTextBuffer(text, width, 40, 14)

/** Create footer image with filter name + date. */
const createFooterImage = async (width: number, filterName: string): Promise<Buffer> => {
  const now = new Date()
  const ts = `${String(now.getFullYear())}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`
  const text = `${filterName}  ${ts}`
  return createTextBuffer(text, width, 30, 10, 'gray')
}

/** Select a decorative border based on sentiment. */
const createFrameSvg = (width: number, height: number, sentimentScore: number): Buffer => {
  // Border style varies by sentiment: positive=double, negative=dashed, neutral=single
  const stroke = 'black'
  const strokeDasharray = sentimentScore <= 0.3 ? '8,4' : 'none'

  const inset = sentimentScore >= 0.7 ? 4 : 8
  const strokeWidth = sentimentScore >= 0.7 ? 3 : 2
  const svg = `<svg width="${String(width)}" height="${String(height)}">
    <rect x="${String(inset)}" y="${String(inset)}"
      width="${String(width - inset * 2)}" height="${String(height - inset * 2)}"
      fill="none" stroke="${stroke}" stroke-width="${String(strokeWidth)}"
      stroke-dasharray="${strokeDasharray}" rx="4" ry="4"/>
    ${sentimentScore >= 0.7 ? `<rect x="${String(inset + 5)}" y="${String(inset + 5)}"
      width="${String(width - (inset + 5) * 2)}" height="${String(height - (inset + 5) * 2)}"
      fill="none" stroke="black" stroke-width="1" rx="2" ry="2"/>` : ''}
  </svg>`
  return Buffer.from(svg)
}

const CLAYCODE_SIZE = 200

export const handler = async (event: PrintPrepareInput): Promise<PrintPrepareOutput> => {
  const { sessionId, collageKey, caption, filter, sentimentScore, downloadCode } = event

  console.log('[print-prepare] input event keys:', Object.keys(event))
  console.log('[print-prepare] downloadCode:', downloadCode, 'type:', typeof downloadCode)

  await notify(sessionId, 60, '印刷データ準備中...')

  const collageBuffer = await getObject(collageKey)

  // Save download copy
  const downloadKey = `downloads/${sessionId}.png`
  await putObject(downloadKey, collageBuffer)

  // Layout: header(50) + collage(576) + caption(40?) + footer(30) + ClayCode(220 if present)
  const headerHeight = 50
  const captionHeight = caption ? 40 : 0
  const footerHeight = 30
  const clayCodeHeight = downloadCode ? CLAYCODE_SIZE + 20 : 0
  const totalHeight = headerHeight + PRINT_WIDTH + captionHeight + footerHeight + clayCodeHeight

  // Build composite overlays
  const overlays: sharp.OverlayOptions[] = []
  let yOffset = 0

  // Header: service name
  overlays.push({
    input: await createHeaderImage(PRINT_WIDTH),
    left: 0,
    top: yOffset,
  })
  yOffset += headerHeight

  // Collage image
  overlays.push({
    input: await sharp(collageBuffer).resize(PRINT_WIDTH, PRINT_WIDTH).toBuffer(),
    left: 0,
    top: yOffset,
  })
  yOffset += PRINT_WIDTH

  // Caption (if available)
  if (caption) {
    overlays.push({
      input: await createCaptionImage(caption, PRINT_WIDTH),
      left: 0,
      top: yOffset,
    })
    yOffset += captionHeight
  }

  // Footer: filter name + timestamp
  overlays.push({
    input: await createFooterImage(PRINT_WIDTH, filter),
    left: 0,
    top: yOffset,
  })
  yOffset += footerHeight

  // ClayCode visual scan code + シルエットオーバーレイ
  if (downloadCode) {
    const claycodeBuffer = await sharp(Buffer.from(generateClaycodeSvg(downloadCode, CLAYCODE_SIZE)))
      .png()
      .toBuffer()

    // シルエット画像をS3から取得して中央に合成
    let claycodeFinal = claycodeBuffer
    try {
      const silhouetteBuffer = await getObject('claycode-shapes/hedgehog.png')
      const silhouetteSize = Math.floor(CLAYCODE_SIZE * 0.5)
      const silhouetteResized = await sharp(silhouetteBuffer)
        .resize(silhouetteSize, silhouetteSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer()

      claycodeFinal = await sharp(claycodeBuffer)
        .composite([{
          input: silhouetteResized,
          left: Math.floor((CLAYCODE_SIZE - silhouetteSize) / 2),
          top: Math.floor((CLAYCODE_SIZE - silhouetteSize) / 2),
        }])
        .png()
        .toBuffer()
    } catch (err) {
      console.error('[print-prepare] silhouette overlay failed:', err)
    }

    overlays.push({
      input: claycodeFinal,
      left: Math.floor((PRINT_WIDTH - CLAYCODE_SIZE) / 2),
      top: yOffset + 10,
    })
  }

  // Sentiment-based decorative frame overlay (over the entire layout)
  const score = sentimentScore ?? 0.5
  overlays.push({
    input: createFrameSvg(PRINT_WIDTH, totalHeight, score),
    left: 0,
    top: 0,
  })

  // Build print layout on white canvas
  const layoutBuffer = await sharp({
    create: {
      width: PRINT_WIDTH,
      height: totalHeight,
      channels: 3 as const,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(overlays)
    .greyscale()
    .raw()
    .toBuffer()

  // Floyd-Steinberg dithering
  const dithered = floydSteinbergDither(
    new Uint8Array(layoutBuffer),
    PRINT_WIDTH,
    totalHeight,
  )

  // Convert back to PNG
  const printBuffer = await sharp(Buffer.from(dithered), {
    raw: { width: PRINT_WIDTH, height: totalHeight, channels: 1 },
  })
    .png()
    .toBuffer()

  const printKey = `print-ready/${sessionId}.png`
  await putObject(printKey, printBuffer)

  await notify(sessionId, 90, '印刷データ準備完了')

  return { ...event, downloadKey, printKey }
}

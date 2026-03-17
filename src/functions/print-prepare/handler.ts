import sharp from 'sharp'
import QRCode from 'qrcode'
import { getObject, putObject } from '../../lib/s3'
import { sendToSession } from '../../lib/websocket'
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
    data: { sessionId, status: 'processing', step: 'print-prepare', progress, message },
  }
  await sendToSession(sessionId, event).catch(() => undefined)
}

/** Create an SVG for the receipt header (service name). */
const createHeaderSvg = (width: number): Buffer => {
  const svg = `<svg width="${String(width)}" height="50">
    <text x="${String(width / 2)}" y="35" font-size="24" font-weight="bold" font-family="sans-serif"
      text-anchor="middle" fill="black">Receipt Purikura</text>
  </svg>`
  return Buffer.from(svg)
}

/** Create an SVG text overlay for caption. */
const createCaptionSvg = (text: string, width: number): Buffer => {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const svg = `<svg width="${String(width)}" height="40">
    <text x="${String(width / 2)}" y="28" font-size="18" font-family="sans-serif"
      text-anchor="middle" fill="black">${escaped}</text>
  </svg>`
  return Buffer.from(svg)
}

/** Create an SVG text overlay for filter name + timestamp. */
const createFooterSvg = (width: number, filterName: string): Buffer => {
  const now = new Date()
  const ts = `${String(now.getFullYear())}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`
  const escaped = filterName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const svg = `<svg width="${String(width)}" height="30">
    <text x="10" y="20" font-size="12" font-family="monospace" fill="gray">${escaped}</text>
    <text x="${String(width - 10)}" y="20" font-size="12" font-family="monospace"
      text-anchor="end" fill="gray">${ts}</text>
  </svg>`
  return Buffer.from(svg)
}

/** Select a decorative border based on sentiment. */
const createFrameSvg = (width: number, height: number, sentimentScore: number): Buffer => {
  // Border style varies by sentiment: positive=double, negative=dashed, neutral=single
  let stroke: string
  let strokeDasharray: string
  if (sentimentScore >= 0.7) {
    stroke = 'black'
    strokeDasharray = 'none'
  } else if (sentimentScore <= 0.3) {
    stroke = 'black'
    strokeDasharray = '8,4'
  } else {
    stroke = 'black'
    strokeDasharray = 'none'
  }

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

export const handler = async (event: PrintPrepareInput): Promise<PrintPrepareOutput> => {
  const { sessionId, collageKey, caption, filter, sentimentScore } = event

  await notify(sessionId, 60, '印刷データ準備中...')

  const collageBuffer = await getObject(collageKey)

  // Save download copy
  const downloadKey = `downloads/${sessionId}.png`
  await putObject(downloadKey, collageBuffer)

  // Generate QR code
  const domain = process.env.DOWNLOAD_DOMAIN ?? 'https://receipt-purikura.example.com'
  const qrBuffer = await QRCode.toBuffer(`${domain}/download/${sessionId}`, {
    type: 'png',
    width: 120,
    margin: 1,
  })

  // Layout: header(50) + collage(576) + caption(40?) + footer(30) + QR(135)
  const headerHeight = 50
  const captionHeight = caption ? 40 : 0
  const footerHeight = 30
  const qrHeight = 135
  const totalHeight = headerHeight + PRINT_WIDTH + captionHeight + footerHeight + qrHeight

  // Build composite overlays
  const overlays: sharp.OverlayOptions[] = []
  let yOffset = 0

  // Header: service name
  overlays.push({
    input: createHeaderSvg(PRINT_WIDTH),
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
      input: createCaptionSvg(caption, PRINT_WIDTH),
      left: 0,
      top: yOffset,
    })
    yOffset += captionHeight
  }

  // Footer: filter name + timestamp
  overlays.push({
    input: createFooterSvg(PRINT_WIDTH, filter),
    left: 0,
    top: yOffset,
  })
  yOffset += footerHeight

  // QR code
  overlays.push({
    input: await sharp(qrBuffer).resize(120, 120).toBuffer(),
    left: Math.floor((PRINT_WIDTH - 120) / 2),
    top: yOffset + 8,
  })

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

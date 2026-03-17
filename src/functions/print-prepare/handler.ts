import sharp from 'sharp'
import QRCode from 'qrcode'
import { getObject, putObject } from '../../lib/s3'
import type { PipelineInput } from '../../lib/types'

interface PrintPrepareInput extends PipelineInput {
  readonly filteredImages: readonly string[]
  readonly collageKey: string
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

export const handler = async (event: PrintPrepareInput): Promise<PrintPrepareOutput> => {
  const { sessionId, collageKey } = event

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

  // Build print layout: collage + QR code at bottom
  const qrComposite = await sharp(collageBuffer)
    .resize(PRINT_WIDTH, PRINT_WIDTH)
    .extend({ bottom: 150, background: { r: 255, g: 255, b: 255 } })
    .composite([
      {
        input: await sharp(qrBuffer).resize(120, 120).toBuffer(),
        left: Math.floor((PRINT_WIDTH - 120) / 2),
        top: PRINT_WIDTH + 15,
      },
    ])
    .greyscale()
    .raw()
    .toBuffer()

  // Get dimensions of the print layout
  const printMeta = await sharp(collageBuffer)
    .resize(PRINT_WIDTH, PRINT_WIDTH)
    .extend({ bottom: 150, background: { r: 255, g: 255, b: 255 } })
    .metadata()
  const printHeight = printMeta.height
  const printWidth = printMeta.width

  // Floyd-Steinberg dithering
  const dithered = floydSteinbergDither(
    new Uint8Array(qrComposite),
    printWidth,
    printHeight,
  )

  // Convert back to PNG
  const printBuffer = await sharp(Buffer.from(dithered), {
    raw: { width: printWidth, height: printHeight, channels: 1 },
  })
    .png()
    .toBuffer()

  const printKey = `print-ready/${sessionId}.png`
  await putObject(printKey, printBuffer)

  return { ...event, downloadKey, printKey }
}

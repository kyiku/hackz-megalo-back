import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockGetObject, mockPutObject, mockSendToSession } = vi.hoisted(() => ({
  mockGetObject: vi.fn(),
  mockPutObject: vi.fn(),
  mockSendToSession: vi.fn(),
}))

const { mockSharp } = vi.hoisted(() => {
  const rawData = new Uint8Array(576 * 576).fill(128)
  const instance = {
    resize: vi.fn().mockReturnThis(),
    greyscale: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    extend: vi.fn().mockReturnThis(),
    raw: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from(rawData)),
    metadata: vi.fn().mockResolvedValue({ width: 576, height: 576 }),
  }
  return { _mockSharpInstance: instance, mockSharp: vi.fn(() => instance) }
})

const { mockQRCodeToBuffer } = vi.hoisted(() => ({
  mockQRCodeToBuffer: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
}))

vi.mock('../../lib/s3', () => ({
  getObject: (...args: unknown[]) => mockGetObject(...args) as unknown,
  putObject: (...args: unknown[]) => mockPutObject(...args) as unknown,
}))

vi.mock('../../lib/websocket', () => ({
  sendToSession: (...args: unknown[]) => mockSendToSession(...args) as unknown,
}))

vi.mock('sharp', () => ({ default: mockSharp }))

vi.mock('qrcode', () => ({
  default: {
    toBuffer: (...args: unknown[]) => mockQRCodeToBuffer(...args) as unknown,
  },
  toBuffer: (...args: unknown[]) => mockQRCodeToBuffer(...args) as unknown,
}))

import { handler } from './handler'

const baseInput = {
  sessionId: 'test-uuid',
  createdAt: '2026-03-16T14:30:00Z',
  filterType: 'simple' as const,
  filter: 'beauty' as const,
  images: ['originals/test-uuid/1.jpg'],
  bucket: 'test-bucket',
  filteredImages: ['filtered/test-uuid/1.png'],
  collageKey: 'collages/test-uuid.png',
}

describe('print-prepare handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetObject.mockResolvedValue(Buffer.from([1, 2, 3]))
    mockPutObject.mockResolvedValue(undefined)
    mockSendToSession.mockResolvedValue(undefined)
    process.env.DOWNLOAD_DOMAIN = 'https://example.com'
  })

  it('should save download image and print-ready image', async () => {
    const result = await handler(baseInput)

    expect(result.downloadKey).toBe('downloads/test-uuid.png')
    expect(result.printKey).toBe('print-ready/test-uuid.png')
  })

  it('should save collage as download image', async () => {
    await handler(baseInput)

    expect(mockPutObject).toHaveBeenCalledWith(
      'downloads/test-uuid.png',
      expect.any(Buffer) as Buffer,
    )
  })

  it('should generate QR code for download URL', async () => {
    await handler(baseInput)

    expect(mockQRCodeToBuffer).toHaveBeenCalledWith(
      'https://example.com/download/test-uuid',
      expect.objectContaining({ type: 'png' }) as Record<string, unknown>,
    )
  })

  it('should create print-ready image with dithering', async () => {
    await handler(baseInput)

    // Should save print-ready image
    expect(mockPutObject).toHaveBeenCalledWith(
      'print-ready/test-uuid.png',
      expect.any(Buffer) as Buffer,
    )
  })

  it('should propagate input fields in result', async () => {
    const result = await handler(baseInput)

    expect(result.sessionId).toBe('test-uuid')
    expect(result.collageKey).toBe('collages/test-uuid.png')
  })

  it('should use default domain when DOWNLOAD_DOMAIN is not set', async () => {
    delete process.env.DOWNLOAD_DOMAIN

    await handler(baseInput)

    expect(mockQRCodeToBuffer).toHaveBeenCalledWith(
      expect.stringContaining('/download/test-uuid') as string,
      expect.any(Object) as Record<string, unknown>,
    )
  })
})

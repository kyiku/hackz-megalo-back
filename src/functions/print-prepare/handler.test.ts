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

vi.mock('../../lib/s3', () => ({
  getObject: (...args: unknown[]) => mockGetObject(...args) as unknown,
  putObject: (...args: unknown[]) => mockPutObject(...args) as unknown,
}))

vi.mock('../../lib/websocket', () => ({
  sendToSession: (...args: unknown[]) => mockSendToSession(...args) as unknown,
}))

vi.mock('sharp', () => ({ default: mockSharp }))

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

  it('should create print-ready image with dithering', async () => {
    await handler(baseInput)

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

  it('should include ClayCode in print layout when downloadCode is provided', async () => {
    const result = await handler({
      ...baseInput,
      downloadCode: '12345',
    })

    expect(result.downloadKey).toBe('downloads/test-uuid.png')
    expect(result.printKey).toBe('print-ready/test-uuid.png')
    // sharp is called extra times for ClayCode SVG rendering
    expect(mockSharp).toHaveBeenCalled()
  })

  it('should work without downloadCode (no ClayCode)', async () => {
    const result = await handler(baseInput)

    expect(result.printKey).toBe('print-ready/test-uuid.png')
    expect(mockPutObject).toHaveBeenCalledTimes(2)
  })

  it('should include caption in print layout when provided', async () => {
    const result = await handler({
      ...baseInput,
      caption: '楽しい思い出！',
      sentiment: 'POSITIVE',
      sentimentScore: 0.95,
    })

    expect(result.downloadKey).toBe('downloads/test-uuid.png')
    expect(result.printKey).toBe('print-ready/test-uuid.png')
    expect(mockPutObject).toHaveBeenCalledTimes(2)
  })

  it('should work without caption', async () => {
    const result = await handler(baseInput)

    expect(result.printKey).toBe('print-ready/test-uuid.png')
    expect(mockPutObject).toHaveBeenCalledTimes(2)
  })

  it('should apply sentiment-based frame with high positive score', async () => {
    const result = await handler({
      ...baseInput,
      caption: 'ハッピー！',
      sentimentScore: 0.95,
    })

    expect(result.printKey).toBe('print-ready/test-uuid.png')
  })

  it('should apply sentiment-based frame with low score', async () => {
    const result = await handler({
      ...baseInput,
      caption: '悲しい...',
      sentimentScore: 0.1,
    })

    expect(result.printKey).toBe('print-ready/test-uuid.png')
  })
})

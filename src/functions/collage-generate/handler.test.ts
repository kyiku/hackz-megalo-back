import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockGetObject, mockPutObject, mockSendToSession } = vi.hoisted(() => ({
  mockGetObject: vi.fn(),
  mockPutObject: vi.fn(),
  mockSendToSession: vi.fn(),
}))

const { mockSharp, mockSharpInstance } = vi.hoisted(() => {
  const instance = {
    resize: vi.fn().mockReturnThis(),
    extract: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  }
  return { mockSharpInstance: instance, mockSharp: vi.fn(() => instance) }
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
  images: ['originals/test-uuid/1.jpg', 'originals/test-uuid/2.jpg'],
  bucket: 'test-bucket',
  filteredImages: [
    'filtered/test-uuid/1.png',
    'filtered/test-uuid/2.png',
    'filtered/test-uuid/3.png',
    'filtered/test-uuid/4.png',
  ],
}

describe('collage-generate handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetObject.mockResolvedValue(Buffer.from([1, 2, 3]))
    mockPutObject.mockResolvedValue(undefined)
    mockSendToSession.mockResolvedValue(undefined)
  })

  it('should generate collage and save to S3', async () => {
    const result = await handler(baseInput)

    expect(mockGetObject).toHaveBeenCalledTimes(4)
    expect(mockPutObject).toHaveBeenCalledOnce()
    expect(result.collageKey).toBe('collages/test-uuid.png')
  })

  it('should create canvas with sharp and composite 4 images', async () => {
    await handler(baseInput)

    const firstCall = mockSharp.mock.calls as unknown[][]
    const canvasCall = firstCall.find(
      (call) => typeof call[0] === 'object' && 'create' in (call[0] as Record<string, unknown>),
    )
    expect(canvasCall).toBeDefined()
    expect(mockSharpInstance.composite).toHaveBeenCalledOnce()
  })

  it('should propagate input fields in result', async () => {
    const result = await handler(baseInput)

    expect(result.sessionId).toBe('test-uuid')
    expect(result.bucket).toBe('test-bucket')
    expect(result.filteredImages).toEqual(baseInput.filteredImages)
  })

  it('should crop images to square before compositing', async () => {
    await handler(baseInput)
    expect(mockSharpInstance.resize).toHaveBeenCalled()
  })

  it('should handle 1 image', async () => {
    const result = await handler({
      ...baseInput,
      filteredImages: ['filtered/test-uuid/1.png'],
    })

    expect(mockGetObject).toHaveBeenCalledTimes(1)
    expect(mockSharpInstance.composite).toHaveBeenCalledOnce()
    expect(result.collageKey).toBe('collages/test-uuid.png')
  })

  it('should handle 2 images', async () => {
    const result = await handler({
      ...baseInput,
      filteredImages: ['filtered/test-uuid/1.png', 'filtered/test-uuid/2.png'],
    })

    expect(mockGetObject).toHaveBeenCalledTimes(2)
    expect(result.collageKey).toBe('collages/test-uuid.png')
  })

  it('should handle 3 images', async () => {
    const result = await handler({
      ...baseInput,
      filteredImages: [
        'filtered/test-uuid/1.png',
        'filtered/test-uuid/2.png',
        'filtered/test-uuid/3.png',
      ],
    })

    expect(mockGetObject).toHaveBeenCalledTimes(3)
    expect(result.collageKey).toBe('collages/test-uuid.png')
  })

  it('should use face data for smart crop when provided', async () => {
    const faces = [
      {
        imageKey: 'originals/test-uuid/1.jpg',
        details: [
          { boundingBox: { width: 0.3, height: 0.4, left: 0.6, top: 0.1 }, confidence: 99.5 },
        ],
      },
      {
        imageKey: 'originals/test-uuid/2.jpg',
        details: [
          { boundingBox: { width: 0.2, height: 0.3, left: 0.4, top: 0.2 }, confidence: 98.0 },
        ],
      },
      { imageKey: 'originals/test-uuid/3.jpg', details: [] },
      { imageKey: 'originals/test-uuid/4.jpg', details: [] },
    ]

    const result = await handler({ ...baseInput, faces })

    expect(mockSharpInstance.extract).toHaveBeenCalledTimes(4)
    expect(result.collageKey).toBe('collages/test-uuid.png')
  })

  it('should fall back to center crop when no face data', async () => {
    const result = await handler(baseInput)

    expect(mockSharpInstance.extract).toHaveBeenCalledTimes(4)
    expect(result.collageKey).toBe('collages/test-uuid.png')
  })

  it('should handle faces with empty details for some images', async () => {
    const faces = [
      {
        imageKey: 'originals/test-uuid/1.jpg',
        details: [
          { boundingBox: { width: 0.3, height: 0.4, left: 0.5, top: 0.2 }, confidence: 99.0 },
        ],
      },
      { imageKey: 'originals/test-uuid/2.jpg', details: [] },
      { imageKey: 'originals/test-uuid/3.jpg', details: [] },
      { imageKey: 'originals/test-uuid/4.jpg', details: [] },
    ]

    const result = await handler({ ...baseInput, faces })

    expect(result.collageKey).toBe('collages/test-uuid.png')
    expect(mockPutObject).toHaveBeenCalledOnce()
  })
})

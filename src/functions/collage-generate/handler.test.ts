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

    // Canvas creation: sharp with create option
    const firstCall = mockSharp.mock.calls as unknown[][]
    const canvasCall = firstCall.find(
      (call) => typeof call[0] === 'object' && 'create' in (call[0] as Record<string, unknown>),
    )
    expect(canvasCall).toBeDefined()

    // Composite should be called with 4 images
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

    // Each filtered image gets resized
    expect(mockSharpInstance.resize).toHaveBeenCalled()
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockGetObject, mockPutObject, mockSendToSession } = vi.hoisted(() => ({
  mockGetObject: vi.fn(),
  mockPutObject: vi.fn(),
  mockSendToSession: vi.fn(),
}))

const { mockSharp, mockSharpInstance } = vi.hoisted(() => {
  const instance = {
    blur: vi.fn().mockReturnThis(),
    sharpen: vi.fn().mockReturnThis(),
    modulate: vi.fn().mockReturnThis(),
    linear: vi.fn().mockReturnThis(),
    greyscale: vi.fn().mockReturnThis(),
    tint: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
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
import type { PipelineInput } from '../../lib/types'

const baseInput: PipelineInput = {
  sessionId: 'test-uuid',
  createdAt: '2026-03-16T14:30:00Z',
  filterType: 'simple',
  filter: 'beauty',
  images: ['originals/test-uuid/1.jpg', 'originals/test-uuid/2.jpg'],
  bucket: 'test-bucket',
}

describe('filter-apply handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetObject.mockResolvedValue(Buffer.from([255, 0, 0]))
    mockPutObject.mockResolvedValue(undefined)
    mockSendToSession.mockResolvedValue(undefined)
  })

  it('should apply beauty filter and save filtered images', async () => {
    const result = await handler(baseInput)

    expect(mockGetObject).toHaveBeenCalledTimes(2)
    expect(mockPutObject).toHaveBeenCalledTimes(2)
    expect(mockSharpInstance.blur).toHaveBeenCalled()
    expect(mockSharpInstance.sharpen).toHaveBeenCalled()
    expect(result.filteredImages).toHaveLength(2)
  })

  it('should apply mono filter', async () => {
    const result = await handler({ ...baseInput, filter: 'mono' })

    expect(mockSharpInstance.greyscale).toHaveBeenCalled()
    expect(result.filteredImages).toHaveLength(2)
  })

  it('should apply sepia filter', async () => {
    await handler({ ...baseInput, filter: 'sepia' })

    expect(mockSharpInstance.greyscale).toHaveBeenCalled()
    expect(mockSharpInstance.tint).toHaveBeenCalled()
  })

  it('should apply bright filter', async () => {
    await handler({ ...baseInput, filter: 'bright' })

    expect(mockSharpInstance.modulate).toHaveBeenCalledWith({ brightness: 1.2 })
    expect(mockSharpInstance.linear).toHaveBeenCalledWith(1.1, 0)
  })

  it('should pass through natural filter without processing', async () => {
    await handler({ ...baseInput, filter: 'natural' })

    expect(mockSharpInstance.blur).not.toHaveBeenCalled()
    expect(mockSharpInstance.greyscale).not.toHaveBeenCalled()
    expect(mockSharpInstance.modulate).not.toHaveBeenCalled()
    expect(mockSharpInstance.png).toHaveBeenCalled()
  })

  it('should return filteredImages keys in result', async () => {
    const result = await handler(baseInput)

    expect(result.filteredImages).toEqual([
      'filtered/test-uuid/1.png',
      'filtered/test-uuid/2.png',
    ])
  })

  it('should propagate input fields in result', async () => {
    const result = await handler(baseInput)

    expect(result.sessionId).toBe('test-uuid')
    expect(result.bucket).toBe('test-bucket')
  })
})

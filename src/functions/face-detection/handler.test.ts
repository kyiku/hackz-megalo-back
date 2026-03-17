import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockRekognitionSend } = vi.hoisted(() => ({
  mockRekognitionSend: vi.fn(),
}))

vi.mock('@aws-sdk/client-rekognition', () => ({
  RekognitionClient: class {
    send = mockRekognitionSend
  },
  DetectFacesCommand: class {
    constructor(public input: unknown) {}
  },
}))

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

const mockFaceDetail = {
  BoundingBox: { Width: 0.3, Height: 0.4, Left: 0.2, Top: 0.1 },
  Emotions: [
    { Type: 'HAPPY', Confidence: 95.5 },
    { Type: 'CALM', Confidence: 3.2 },
  ],
  Confidence: 99.8,
}

describe('face-detection handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should detect faces in all images', async () => {
    mockRekognitionSend.mockResolvedValue({
      FaceDetails: [mockFaceDetail],
    })

    const result = await handler(baseInput)

    expect(mockRekognitionSend).toHaveBeenCalledTimes(2)
    expect(result.faces).toHaveLength(2)
  })

  it('should return face bounding boxes and emotions', async () => {
    mockRekognitionSend.mockResolvedValue({
      FaceDetails: [mockFaceDetail],
    })

    const result = await handler(baseInput)
    const firstImage = result.faces[0] as { imageKey: string; details: readonly unknown[] }

    expect(firstImage.imageKey).toBe('originals/test-uuid/1.jpg')
    expect(firstImage.details).toHaveLength(1)
  })

  it('should handle images with no faces', async () => {
    mockRekognitionSend.mockResolvedValue({
      FaceDetails: [],
    })

    const result = await handler(baseInput)
    const firstImage = result.faces[0] as { details: readonly unknown[] }

    expect(firstImage.details).toHaveLength(0)
  })

  it('should propagate input fields', async () => {
    mockRekognitionSend.mockResolvedValue({ FaceDetails: [] })

    const result = await handler(baseInput)

    expect(result.sessionId).toBe('test-uuid')
    expect(result.bucket).toBe('test-bucket')
  })

  it('should handle Rekognition errors gracefully', async () => {
    mockRekognitionSend.mockRejectedValue(new Error('Rekognition error'))

    await expect(handler(baseInput)).rejects.toThrow('Rekognition error')
  })
})

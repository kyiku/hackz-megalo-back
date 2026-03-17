import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockRekognitionSend, mockSendToSession } = vi.hoisted(() => ({
  mockRekognitionSend: vi.fn(),
  mockSendToSession: vi.fn(),
}))

vi.mock('@aws-sdk/client-rekognition', () => ({
  RekognitionClient: class {
    send = mockRekognitionSend
  },
  DetectFacesCommand: class {
    constructor(public input: unknown) {}
  },
}))

vi.mock('../../lib/websocket', () => ({
  sendToSession: (...args: unknown[]) => mockSendToSession(...args) as unknown,
}))

import { handler } from './handler'

const baseInput = {
  sessionId: 'test-uuid',
  bucket: 'test-bucket',
  images: ['originals/test-uuid/1.jpg'],
}

describe('yaji-comment-fast handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendToSession.mockResolvedValue(undefined)
  })

  it('should detect emotions and send template comment', async () => {
    mockRekognitionSend.mockResolvedValue({
      FaceDetails: [
        {
          Emotions: [
            { Type: 'HAPPY', Confidence: 95 },
            { Type: 'CALM', Confidence: 3 },
          ],
        },
      ],
    })

    const result = await handler(baseInput)

    expect(mockSendToSession).toHaveBeenCalledWith(
      'test-uuid',
      expect.objectContaining({
        type: 'yajiComment',
        data: expect.objectContaining({
          lane: 'fast',
          emotion: 'HAPPY',
        }) as Record<string, unknown>,
      }),
    )
    expect(result.sessionId).toBe('test-uuid')
  })

  it('should handle no faces detected', async () => {
    mockRekognitionSend.mockResolvedValue({ FaceDetails: [] })

    const result = await handler(baseInput)

    expect(mockSendToSession).not.toHaveBeenCalled()
    expect(result.sessionId).toBe('test-uuid')
  })

  it('should use first image for detection', async () => {
    mockRekognitionSend.mockResolvedValue({ FaceDetails: [] })

    await handler(baseInput)

    expect(mockRekognitionSend).toHaveBeenCalledOnce()
  })
})

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

const happyFace = {
  FaceDetails: [
    {
      Emotions: [
        { Type: 'HAPPY', Confidence: 95 },
        { Type: 'CALM', Confidence: 3 },
      ],
    },
  ],
}

describe('yaji-comment-fast handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendToSession.mockResolvedValue(undefined)
  })

  it('should detect emotions and send template comment (YajiInput)', async () => {
    mockRekognitionSend.mockResolvedValue(happyFace)

    await handler(baseInput)

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
  })

  it('should handle no faces detected', async () => {
    mockRekognitionSend.mockResolvedValue({ FaceDetails: [] })

    await handler(baseInput)

    expect(mockSendToSession).not.toHaveBeenCalled()
  })

  it('should use first image for detection', async () => {
    mockRekognitionSend.mockResolvedValue({ FaceDetails: [] })

    await handler(baseInput)

    expect(mockRekognitionSend).toHaveBeenCalledOnce()
  })

  it('should handle EventBridge S3 event and extract sessionId from key', async () => {
    mockRekognitionSend.mockResolvedValue(happyFace)

    const eventBridgeEvent = {
      source: 'aws.s3' as const,
      detail: {
        bucket: { name: 'test-bucket' },
        object: { key: 'yaji-frames/test-uuid/1234567890.jpg' },
      },
    }

    await handler(eventBridgeEvent)

    expect(mockRekognitionSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Image: { S3Object: { Bucket: 'test-bucket', Name: 'yaji-frames/test-uuid/1234567890.jpg' } },
        }) as unknown,
      }),
    )
    expect(mockSendToSession).toHaveBeenCalledWith('test-uuid', expect.anything())
  })

  it('should skip EventBridge event with missing sessionId in key', async () => {
    const eventBridgeEvent = {
      source: 'aws.s3' as const,
      detail: {
        bucket: { name: 'test-bucket' },
        object: { key: 'yaji-frames/' },
      },
    }

    await handler(eventBridgeEvent)

    expect(mockRekognitionSend).not.toHaveBeenCalled()
  })

  it('should skip YajiInput with no images', async () => {
    await handler({ ...baseInput, images: [] })
    expect(mockRekognitionSend).not.toHaveBeenCalled()
  })
})

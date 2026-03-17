import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockBedrockSend, mockGetObject, mockSendToSession } = vi.hoisted(() => ({
  mockBedrockSend: vi.fn(),
  mockGetObject: vi.fn(),
  mockSendToSession: vi.fn(),
}))

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    send = mockBedrockSend
  },
  InvokeModelCommand: class {
    constructor(public input: unknown) {}
  },
}))

vi.mock('../../lib/s3', () => ({
  getObject: (...args: unknown[]) => mockGetObject(...args) as unknown,
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

describe('yaji-comment-deep handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetObject.mockResolvedValue(Buffer.from([1, 2, 3]))
    mockSendToSession.mockResolvedValue(undefined)
    mockBedrockSend.mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ text: 'めっちゃ楽しそうやんｗｗ' }],
        }),
      ),
    })
  })

  it('should generate deep comment via Bedrock and send via WebSocket', async () => {
    const result = await handler(baseInput)

    expect(mockBedrockSend).toHaveBeenCalledOnce()
    expect(mockSendToSession).toHaveBeenCalledWith(
      'test-uuid',
      expect.objectContaining({
        type: 'yajiComment',
        data: expect.objectContaining({
          text: 'めっちゃ楽しそうやんｗｗ',
          lane: 'deep',
        }) as Record<string, unknown>,
      }),
    )
    expect(result.sessionId).toBe('test-uuid')
  })

  it('should read first image from S3', async () => {
    await handler(baseInput)

    expect(mockGetObject).toHaveBeenCalledWith('originals/test-uuid/1.jpg')
  })

  it('should propagate input', async () => {
    const result = await handler(baseInput)

    expect(result.bucket).toBe('test-bucket')
  })

  it('should return event without error when Bedrock fails', async () => {
    mockBedrockSend.mockRejectedValue(new Error('Bedrock throttling'))

    const result = await handler(baseInput)

    expect(result.sessionId).toBe('test-uuid')
    expect(mockSendToSession).not.toHaveBeenCalled()
  })
})

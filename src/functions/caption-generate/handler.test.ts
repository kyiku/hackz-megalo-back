import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockBedrockSend, mockComprehendSend, mockGetObject, mockUpdateSession, mockSendToSession } =
  vi.hoisted(() => ({
    mockBedrockSend: vi.fn(),
    mockComprehendSend: vi.fn(),
    mockGetObject: vi.fn(),
    mockUpdateSession: vi.fn(),
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

vi.mock('@aws-sdk/client-comprehend', () => ({
  ComprehendClient: class {
    send = mockComprehendSend
  },
  DetectSentimentCommand: class {
    constructor(public input: unknown) {}
  },
}))

vi.mock('../../lib/s3', () => ({
  getObject: (...args: unknown[]) => mockGetObject(...args) as unknown,
}))

vi.mock('../../lib/dynamodb', () => ({
  updateSession: (...args: unknown[]) => mockUpdateSession(...args) as unknown,
}))

vi.mock('../../lib/websocket', () => ({
  sendToSession: (...args: unknown[]) => mockSendToSession(...args) as unknown,
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

describe('caption-generate handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendToSession.mockResolvedValue(undefined)
    mockGetObject.mockResolvedValue(Buffer.from([1, 2, 3]))
    mockBedrockSend.mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ text: '楽しい思い出の一枚！' }],
        }),
      ),
    })
    mockComprehendSend.mockResolvedValue({
      Sentiment: 'POSITIVE',
      SentimentScore: {
        Positive: 0.95,
        Negative: 0.01,
        Neutral: 0.03,
        Mixed: 0.01,
      },
    })
    mockUpdateSession.mockResolvedValue(undefined)
  })

  it('should generate caption and detect sentiment', async () => {
    const result = await handler(baseInput)

    expect(result.caption).toBe('楽しい思い出の一枚！')
    expect(result.sentiment).toBe('POSITIVE')
    expect(result.sentimentScore).toBe(0.95)
  })

  it('should call Bedrock with collage image', async () => {
    await handler(baseInput)

    expect(mockBedrockSend).toHaveBeenCalledOnce()
    expect(mockGetObject).toHaveBeenCalledWith('collages/test-uuid.png')
  })

  it('should call Comprehend with generated caption', async () => {
    await handler(baseInput)

    expect(mockComprehendSend).toHaveBeenCalledOnce()
  })

  it('should update session with caption and sentiment', async () => {
    await handler(baseInput)

    expect(mockUpdateSession).toHaveBeenCalledWith(
      'test-uuid',
      '2026-03-16T14:30:00Z',
      expect.objectContaining({
        caption: '楽しい思い出の一枚！',
        sentiment: 'POSITIVE',
        sentimentScore: 0.95,
      }),
    )
  })

  it('should propagate input fields', async () => {
    const result = await handler(baseInput)

    expect(result.sessionId).toBe('test-uuid')
    expect(result.collageKey).toBe('collages/test-uuid.png')
  })

  it('should return empty caption when Bedrock fails', async () => {
    mockBedrockSend.mockRejectedValue(new Error('Bedrock throttling'))

    const result = await handler(baseInput)

    expect(result.caption).toBe('')
    expect(result.sentiment).toBe('NEUTRAL')
    expect(result.sentimentScore).toBe(0)
    expect(mockUpdateSession).toHaveBeenCalled()
  })

  it('should return default sentiment when Comprehend fails', async () => {
    mockComprehendSend.mockRejectedValue(new Error('Comprehend error'))

    const result = await handler(baseInput)

    expect(result.caption).toBe('楽しい思い出の一枚！')
    expect(result.sentiment).toBe('NEUTRAL')
    expect(result.sentimentScore).toBe(0)
  })
})

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

const { mockBedrockSend } = vi.hoisted(() => ({
  mockBedrockSend: vi.fn(),
}))

vi.mock('../../lib/s3', () => ({
  getObject: (...args: unknown[]) => mockGetObject(...args) as unknown,
  putObject: (...args: unknown[]) => mockPutObject(...args) as unknown,
}))

vi.mock('../../lib/websocket', () => ({
  sendToSession: (...args: unknown[]) => mockSendToSession(...args) as unknown,
}))

vi.mock('sharp', () => ({ default: mockSharp }))

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    send = mockBedrockSend
  },
  InvokeModelCommand: class {
    constructor(public input: unknown) {}
  },
}))

// p-limit passthrough mock: concurrency limit is tested via Bedrock call count in integration
vi.mock('p-limit', () => ({
  default: () => (fn: () => unknown) => fn(),
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

describe('filter-apply handler (AI filters)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetObject.mockResolvedValue(Buffer.from([255, 0, 0]))
    mockPutObject.mockResolvedValue(undefined)

    // Mock Bedrock response with base64-encoded PNG
    const fakeBase64 = Buffer.from([1, 2, 3]).toString('base64')
    mockBedrockSend.mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({ images: [fakeBase64] }),
      ),
    })
  })

  it('should call Bedrock for anime filter', async () => {
    const result = await handler({
      ...baseInput,
      filterType: 'ai',
      filter: 'anime',
    })

    // 1 style reference + 2 photo images = 3 getObject calls
    expect(mockGetObject).toHaveBeenCalledTimes(3)
    expect(mockGetObject).toHaveBeenCalledWith('style-references/anime.jpg')
    expect(mockBedrockSend).toHaveBeenCalledTimes(2)
    expect(mockSharpInstance.blur).not.toHaveBeenCalled()
    expect(result.filteredImages).toHaveLength(2)
  })

  it('should call Bedrock for popart filter', async () => {
    await handler({
      ...baseInput,
      filterType: 'ai',
      filter: 'popart',
    })

    expect(mockGetObject).toHaveBeenCalledWith('style-references/popart.jpg')
    expect(mockBedrockSend).toHaveBeenCalledTimes(2)
  })

  it('should call Bedrock for watercolor filter', async () => {
    await handler({
      ...baseInput,
      filterType: 'ai',
      filter: 'watercolor',
    })

    expect(mockGetObject).toHaveBeenCalledWith('style-references/watercolor.jpg')
    expect(mockBedrockSend).toHaveBeenCalledTimes(2)
  })

  it('should use correct model ID (stable-style-transfer-v1)', async () => {
    await handler({
      ...baseInput,
      filterType: 'ai',
      filter: 'anime',
    })

    expect(mockGetObject).toHaveBeenCalledWith('style-references/anime.jpg')
    const call = mockBedrockSend.mock.calls[0]?.[0] as { input: { modelId: string; body: string } }
    expect(call.input.modelId).toBe('stability.stable-style-transfer-v1:0')
  })

  it('should send style_image and style_strength parameters', async () => {
    await handler({
      ...baseInput,
      filterType: 'ai',
      filter: 'anime',
    })

    const call = mockBedrockSend.mock.calls[0]?.[0] as { input: { body: string } }
    const body = JSON.parse(call.input.body) as Record<string, unknown>
    expect(body).toHaveProperty('style_image')
    expect(body).toHaveProperty('style_strength')
    expect(body).toHaveProperty('composition_fidelity')
    expect(body).toHaveProperty('change_strength')
    expect(body.image).toBeTypeOf('string')
    expect(body).not.toHaveProperty('prompt')
    expect(body).not.toHaveProperty('mode')
  })

  it('should save AI-filtered images to S3', async () => {
    await handler({
      ...baseInput,
      filterType: 'ai',
      filter: 'anime',
    })

    expect(mockPutObject).toHaveBeenCalledTimes(2)
    expect(mockPutObject).toHaveBeenCalledWith(
      'filtered/test-uuid/1.png',
      expect.any(Buffer) as Buffer,
    )
  })

  it('should fall back to simple filter for simple filterType even with AI filter name', async () => {
    await handler({
      ...baseInput,
      filterType: 'simple',
      filter: 'anime',
    })

    expect(mockBedrockSend).not.toHaveBeenCalled()
    expect(mockSharpInstance.png).toHaveBeenCalled()
  })

  it('should propagate Bedrock error when AI filter fails', async () => {
    mockBedrockSend.mockRejectedValueOnce(new Error('ThrottlingException'))

    await expect(
      handler({ ...baseInput, filterType: 'ai', filter: 'anime' }),
    ).rejects.toThrow('ThrottlingException')
  })
})

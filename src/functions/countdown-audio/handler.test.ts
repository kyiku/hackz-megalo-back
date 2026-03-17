import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockPollySend, mockPutObject } = vi.hoisted(() => ({
  mockPollySend: vi.fn(),
  mockPutObject: vi.fn(),
}))

vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: class {
    send = mockPollySend
  },
  SynthesizeSpeechCommand: class {
    constructor(public input: unknown) {}
  },
}))

vi.mock('../../lib/s3', () => ({
  putObject: (...args: unknown[]) => mockPutObject(...args) as unknown,
}))

import { handler } from './handler'

describe('countdown-audio handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPollySend.mockResolvedValue({
      AudioStream: {
        transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      },
    })
    mockPutObject.mockResolvedValue(undefined)
  })

  it('should generate 4 countdown audio files', async () => {
    const result = await handler()

    expect(mockPollySend).toHaveBeenCalledTimes(4)
    expect(mockPutObject).toHaveBeenCalledTimes(4)
    expect(result.audioKeys).toHaveLength(4)
  })

  it('should save audio files with correct S3 keys', async () => {
    const result = await handler()

    expect(result.audioKeys).toContain('countdown/3.mp3')
    expect(result.audioKeys).toContain('countdown/cheese.mp3')
  })

  it('should use Mizuki voice with neural engine', async () => {
    await handler()

    const firstCall = mockPollySend.mock.calls[0] as [{ input: Record<string, unknown> }]
    expect(firstCall[0].input).toEqual(
      expect.objectContaining({
        VoiceId: 'Mizuki',
        Engine: 'neural',
      }),
    )
  })
})

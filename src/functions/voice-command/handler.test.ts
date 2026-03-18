import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockTranscribeSend, mockGetObject } = vi.hoisted(() => ({
  mockTranscribeSend: vi.fn(),
  mockGetObject: vi.fn(),
}))

vi.mock('@aws-sdk/client-transcribe', () => ({
  TranscribeClient: class {
    send = mockTranscribeSend
  },
  StartTranscriptionJobCommand: class {
    constructor(public input: unknown) {}
  },
  GetTranscriptionJobCommand: class {
    constructor(public input: unknown) {}
  },
}))

vi.mock('../../lib/s3', () => ({
  getObject: (...args: unknown[]) => mockGetObject(...args) as unknown,
}))

import { handler } from './handler'

const baseInput = {
  sessionId: 'test-uuid',
  audioKey: 'voice/test-uuid.webm',
  bucket: 'test-bucket',
}

describe('voice-command handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetObject.mockResolvedValue(Buffer.from([1, 2, 3]))
    mockTranscribeSend
      .mockResolvedValueOnce({}) // StartTranscriptionJob
      .mockResolvedValue({
        TranscriptionJob: {
          TranscriptionJobStatus: 'COMPLETED',
          Transcript: {
            TranscriptFileUri: 'https://s3.amazonaws.com/transcript.json',
          },
        },
      })

    // Mock fetch for transcript result
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: { transcripts: [{ transcript: '撮って' }] },
      }),
    }))
  })

  it('should detect shutter command from transcript', async () => {
    const result = await handler(baseInput)

    expect(result.command).toBe('shutter')
    expect(result.transcript).toBe('撮って')
  })

  it('should return unknown for non-matching transcript', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: { transcripts: [{ transcript: 'こんにちは' }] },
      }),
    }))

    const result = await handler(baseInput)

    expect(result.command).toBe('unknown')
  })

  it('should return unknown command when fetch returns HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    }))

    const result = await handler(baseInput)

    expect(result.command).toBe('unknown')
    expect(result.transcript).toBe('')
  })

  it('should start transcription job with correct params', async () => {
    await handler(baseInput)

    expect(mockTranscribeSend).toHaveBeenCalled()
    expect(mockGetObject).toHaveBeenCalledWith('voice/test-uuid.webm')
  })
})

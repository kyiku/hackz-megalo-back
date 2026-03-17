import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockIotSend, mockUpdateSession, mockSendToSession, mockGeneratePresignedDownloadUrl } = vi.hoisted(() => ({
  mockIotSend: vi.fn(),
  mockUpdateSession: vi.fn(),
  mockSendToSession: vi.fn(),
  mockGeneratePresignedDownloadUrl: vi.fn(),
}))

vi.mock('@aws-sdk/client-iot-data-plane', () => ({
  IoTDataPlaneClient: class {
    send = mockIotSend
  },
  PublishCommand: class {
    constructor(public input: unknown) {}
  },
}))

vi.mock('../../lib/dynamodb', () => ({
  updateSession: (...args: unknown[]) => mockUpdateSession(...args) as unknown,
}))

vi.mock('../../lib/s3', () => ({
  generatePresignedDownloadUrl: (...args: unknown[]) =>
    mockGeneratePresignedDownloadUrl(...args) as unknown,
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
  downloadKey: 'downloads/test-uuid.png',
  printKey: 'print-ready/test-uuid.png',
}

describe('pipeline-complete handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.IOT_ENDPOINT = 'test-iot.iot.ap-northeast-1.amazonaws.com'
    mockIotSend.mockResolvedValue(undefined)
    mockUpdateSession.mockResolvedValue(undefined)
    mockSendToSession.mockResolvedValue(undefined)
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://presigned/collage-url')
  })

  it('should publish print job to IoT Core', async () => {
    await handler(baseInput)

    expect(mockIotSend).toHaveBeenCalledOnce()
  })

  it('should update session status to completed', async () => {
    await handler(baseInput)

    expect(mockUpdateSession).toHaveBeenCalledWith(
      'test-uuid',
      '2026-03-16T14:30:00Z',
      expect.objectContaining({
        status: 'completed',
        printImageKey: 'print-ready/test-uuid.png',
        collageImageKey: 'collages/test-uuid.png',
        downloadKey: 'downloads/test-uuid.png',
      }),
    )
  })

  it('should send completed event with presigned URL via WebSocket', async () => {
    await handler(baseInput)

    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'downloads/test-uuid.png',
      3600,
    )
    expect(mockSendToSession).toHaveBeenCalledWith(
      'test-uuid',
      expect.objectContaining({
        type: 'completed',
        data: expect.objectContaining({
          sessionId: 'test-uuid',
          collageImageUrl: 'https://presigned/collage-url',
        }) as Record<string, unknown>,
      }),
    )
  })

  it('should return result with status completed', async () => {
    const result = await handler(baseInput)

    expect(result.status).toBe('completed')
    expect(result.sessionId).toBe('test-uuid')
  })

  it('should work without IOT_ENDPOINT (skip MQTT)', async () => {
    delete process.env.IOT_ENDPOINT

    const result = await handler(baseInput)

    expect(mockIotSend).not.toHaveBeenCalled()
    expect(mockUpdateSession).toHaveBeenCalled()
    expect(result.status).toBe('completed')
  })
})

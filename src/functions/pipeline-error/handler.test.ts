import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockUpdateSession, mockSendToSession } = vi.hoisted(() => ({
  mockUpdateSession: vi.fn(),
  mockSendToSession: vi.fn(),
}))

vi.mock('../../lib/dynamodb', () => ({
  updateSession: (...args: unknown[]) => mockUpdateSession(...args) as unknown,
}))

vi.mock('../../lib/websocket', () => ({
  sendToSession: (...args: unknown[]) => mockSendToSession(...args) as unknown,
}))

import { handler } from './handler'

describe('pipeline-error handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSession.mockResolvedValue(undefined)
    mockSendToSession.mockResolvedValue(undefined)
  })

  it('should update session status to failed and send error event', async () => {
    await handler({
      sessionId: 'test-uuid',
      createdAt: '2026-03-16T14:30:00Z',
      error: { cause: 'Lambda timeout' },
    })

    expect(mockUpdateSession).toHaveBeenCalledWith(
      'test-uuid',
      '2026-03-16T14:30:00Z',
      { status: 'failed' },
    )
    expect(mockSendToSession).toHaveBeenCalledWith(
      'test-uuid',
      expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({
          sessionId: 'test-uuid',
          message: '処理中にエラーが発生しました',
        }) as Record<string, unknown>,
      }),
    )
  })

  it('should skip when sessionId is missing', async () => {
    await handler({ createdAt: '2026-03-16T14:30:00Z' })

    expect(mockUpdateSession).not.toHaveBeenCalled()
    expect(mockSendToSession).not.toHaveBeenCalled()
  })

  it('should not throw when updateSession fails', async () => {
    mockUpdateSession.mockRejectedValue(new Error('DynamoDB error'))

    await handler({
      sessionId: 'test-uuid',
      createdAt: '2026-03-16T14:30:00Z',
    })

    expect(mockSendToSession).toHaveBeenCalled()
  })

  it('should not throw when sendToSession fails', async () => {
    mockSendToSession.mockRejectedValue(new Error('WebSocket error'))

    await expect(handler({
      sessionId: 'test-uuid',
      createdAt: '2026-03-16T14:30:00Z',
    })).resolves.toBeUndefined()
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockSend, mockDeleteConnection, mockQueryConnectionsBySessionId } =
  vi.hoisted(() => ({
    mockSend: vi.fn(),
    mockDeleteConnection: vi.fn(),
    mockQueryConnectionsBySessionId: vi.fn(),
  }))

const { MockGoneException } = vi.hoisted(() => ({
  MockGoneException: class MockGoneException extends Error {
    readonly name = 'GoneException'
    constructor() {
      super('Gone')
    }
  },
}))

vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: class {
    send = mockSend
  },
  PostToConnectionCommand: class {
    constructor(public input: unknown) {}
  },
  GoneException: MockGoneException,
}))

vi.mock('./dynamodb', () => ({
  queryConnectionsBySessionId: (...args: unknown[]) =>
    mockQueryConnectionsBySessionId(...args) as unknown,
  deleteConnection: (...args: unknown[]) => mockDeleteConnection(...args) as unknown,
}))

import { sendToConnection, sendToSession } from './websocket'

describe('websocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WEBSOCKET_URL =
      'wss://abc123.execute-api.ap-northeast-1.amazonaws.com/dev'
  })

  describe('sendToConnection', () => {
    it('should send a message to a connection', async () => {
      mockSend.mockResolvedValueOnce({})
      await sendToConnection('conn-1', { type: 'test' })
      expect(mockSend).toHaveBeenCalledOnce()
    })

    it('should delete stale connection on GoneException', async () => {
      mockSend.mockRejectedValueOnce(new MockGoneException())
      mockDeleteConnection.mockResolvedValueOnce(undefined)
      await sendToConnection('stale-conn', { type: 'test' })
      expect(mockDeleteConnection).toHaveBeenCalledWith('stale-conn')
    })

    it('should rethrow non-GoneException errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'))
      await expect(
        sendToConnection('conn-1', { type: 'test' }),
      ).rejects.toThrow('Network error')
    })
  })

  describe('sendToSession', () => {
    it('should send to all connections for a session', async () => {
      mockSend.mockResolvedValue({})
      mockQueryConnectionsBySessionId.mockResolvedValueOnce([
        { connectionId: 'conn-1', connectedAt: Date.now(), ttl: 0 },
        { connectionId: 'conn-2', connectedAt: Date.now(), ttl: 0 },
      ])
      await sendToSession('session-1', { type: 'test' })
      expect(mockSend).toHaveBeenCalledTimes(2)
    })

    it('should do nothing when no connections exist', async () => {
      mockQueryConnectionsBySessionId.mockResolvedValueOnce([])
      await sendToSession('empty-session', { type: 'test' })
      expect(mockSend).not.toHaveBeenCalled()
    })
  })
})

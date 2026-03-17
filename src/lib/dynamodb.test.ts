import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Session, Connection } from './types'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@aws-sdk/client-dynamodb', () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  DynamoDBClient: class DynamoDBClient {},
}))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  GetCommand: class {
    constructor(public input: unknown) {}
  },
  PutCommand: class {
    constructor(public input: unknown) {}
  },
  UpdateCommand: class {
    constructor(public input: unknown) {}
  },
  DeleteCommand: class {
    constructor(public input: unknown) {}
  },
  QueryCommand: class {
    constructor(public input: unknown) {}
  },
}))

import {
  getSession,
  putSession,
  updateSession,
  putConnection,
  deleteConnection,
  updateConnection,
  queryConnectionsBySessionId,
  queryConnectionsByRoomId,
} from './dynamodb'

const testSession: Session = {
  sessionId: 'test-session-id',
  createdAt: '2026-03-16T14:30:00Z',
  filterType: 'simple',
  filter: 'beauty',
  status: 'uploading',
  photoCount: 4,
  ttl: Math.floor(Date.now() / 1000) + 30 * 86400,
}

const testConnection: Connection = {
  connectionId: 'conn-123',
  sessionId: 'test-session-id',
  roomId: 'room-1',
  role: 'phone',
  connectedAt: Date.now(),
  ttl: Math.floor(Date.now() / 1000) + 86400,
}

describe('dynamodb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DYNAMODB_TABLE = 'test-sessions'
    process.env.CONNECTIONS_TABLE = 'test-connections'
  })

  describe('getSession', () => {
    it('should return a session when found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [testSession] })
      const result = await getSession('test-session-id')
      expect(result).toEqual(testSession)
    })

    it('should return undefined when not found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] })
      const result = await getSession('nonexistent')
      expect(result).toBeUndefined()
    })

    it('should throw when DYNAMODB_TABLE is not set', async () => {
      delete process.env.DYNAMODB_TABLE
      await expect(getSession('test')).rejects.toThrow('DYNAMODB_TABLE is not set')
    })
  })

  describe('putSession', () => {
    it('should put a session', async () => {
      mockSend.mockResolvedValueOnce({})
      await putSession(testSession)
      expect(mockSend).toHaveBeenCalledOnce()
    })
  })

  describe('updateSession', () => {
    it('should update session attributes', async () => {
      mockSend.mockResolvedValueOnce({})
      await updateSession('test-id', '2026-03-16T14:30:00Z', {
        status: 'processing',
      })
      expect(mockSend).toHaveBeenCalledOnce()
    })

    it('should not send command for empty updates', async () => {
      await updateSession('test-id', '2026-03-16T14:30:00Z', {})
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should filter out disallowed fields', async () => {
      mockSend.mockResolvedValueOnce({})
      await updateSession('test-id', '2026-03-16T14:30:00Z', {
        status: 'completed',
        sessionId: 'hacked',
        createdAt: 'hacked',
      })
      expect(mockSend).toHaveBeenCalledOnce()
    })

    it('should skip update entirely when only disallowed fields are provided', async () => {
      await updateSession('test-id', '2026-03-16T14:30:00Z', {
        sessionId: 'hacked',
        createdAt: 'hacked',
        ttl: 999,
      })
      expect(mockSend).not.toHaveBeenCalled()
    })
  })

  describe('putConnection', () => {
    it('should put a connection', async () => {
      mockSend.mockResolvedValueOnce({})
      await putConnection(testConnection)
      expect(mockSend).toHaveBeenCalledOnce()
    })
  })

  describe('deleteConnection', () => {
    it('should delete a connection', async () => {
      mockSend.mockResolvedValueOnce({})
      await deleteConnection('conn-123')
      expect(mockSend).toHaveBeenCalledOnce()
    })
  })

  describe('updateConnection', () => {
    it('should update connection attributes', async () => {
      mockSend.mockResolvedValueOnce({})
      await updateConnection('conn-123', { sessionId: 'new-session' })
      expect(mockSend).toHaveBeenCalledOnce()
    })

    it('should not send command for empty updates', async () => {
      await updateConnection('conn-123', {})
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should throw when CONNECTIONS_TABLE is not set', async () => {
      delete process.env.CONNECTIONS_TABLE
      await expect(
        updateConnection('conn-123', { sessionId: 'x' }),
      ).rejects.toThrow('CONNECTIONS_TABLE is not set')
    })
  })

  describe('queryConnectionsBySessionId', () => {
    it('should return connections for a session', async () => {
      mockSend.mockResolvedValueOnce({ Items: [testConnection] })
      const result = await queryConnectionsBySessionId('test-session-id')
      expect(result).toEqual([testConnection])
    })

    it('should return empty array when no connections', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] })
      const result = await queryConnectionsBySessionId('nonexistent')
      expect(result).toEqual([])
    })
  })

  describe('queryConnectionsByRoomId', () => {
    it('should return connections for a room', async () => {
      mockSend.mockResolvedValueOnce({ Items: [testConnection] })
      const result = await queryConnectionsByRoomId('room-1')
      expect(result).toEqual([testConnection])
    })
  })
})

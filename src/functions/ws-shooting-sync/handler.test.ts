import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { APIGatewayProxyResult, Context } from 'aws-lambda'

const { mockQueryConnectionsByRoomId, mockSendToConnection } = vi.hoisted(() => ({
  mockQueryConnectionsByRoomId: vi.fn(),
  mockSendToConnection: vi.fn(),
}))

vi.mock('../../lib/dynamodb', () => ({
  queryConnectionsByRoomId: (...args: unknown[]) =>
    mockQueryConnectionsByRoomId(...args) as unknown,
}))

vi.mock('../../lib/websocket', () => ({
  sendToConnection: (...args: unknown[]) => mockSendToConnection(...args) as unknown,
}))

import { handler } from './handler'

const mockContext = {} as Context

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {}

const createEvent = (connectionId: string, body: unknown) =>
  ({
    requestContext: { connectionId, eventType: 'MESSAGE', routeKey: 'shooting_sync' },
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
  }) as Parameters<typeof handler>[0]

describe('ws-shooting-sync handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should relay shooting_start event to other connections', async () => {
    mockQueryConnectionsByRoomId.mockResolvedValueOnce([
      { connectionId: 'phone-1', connectedAt: 0, ttl: 0 },
      { connectionId: 'pc-1', connectedAt: 0, ttl: 0 },
    ])
    mockSendToConnection.mockResolvedValue(undefined)

    const data = {
      roomId: 'room-1',
      event: 'shooting_start',
      sessionId: 'session-1',
      totalPhotos: 4,
    }

    const result = (await handler(
      createEvent('phone-1', { action: 'shooting_sync', data }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(200)
    expect(mockSendToConnection).toHaveBeenCalledOnce()
    expect(mockSendToConnection).toHaveBeenCalledWith('pc-1', {
      type: 'shooting_sync',
      data: {
        event: 'shooting_start',
        sessionId: 'session-1',
        totalPhotos: 4,
      },
    })
  })

  it('should relay countdown event', async () => {
    mockQueryConnectionsByRoomId.mockResolvedValueOnce([
      { connectionId: 'phone-1', connectedAt: 0, ttl: 0 },
      { connectionId: 'pc-1', connectedAt: 0, ttl: 0 },
    ])
    mockSendToConnection.mockResolvedValue(undefined)

    const data = {
      roomId: 'room-1',
      event: 'countdown',
      photoIndex: 1,
      count: 3,
    }

    const result = (await handler(
      createEvent('phone-1', { action: 'shooting_sync', data }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(200)
  })

  it('should return 400 for invalid event type', async () => {
    const result = (await handler(
      createEvent('conn-1', { action: 'shooting_sync', data: { roomId: 'room-1', event: 'invalid' } }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(400)
  })

  it('should return 500 on error', async () => {
    mockQueryConnectionsByRoomId.mockRejectedValueOnce(new Error('fail'))

    const result = (await handler(
      createEvent('conn-1', { action: 'shooting_sync', data: { roomId: 'room-1', event: 'shutter', photoIndex: 1 } }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(500)
  })
})

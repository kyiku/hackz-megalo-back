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
    requestContext: { connectionId, eventType: 'MESSAGE', routeKey: 'webrtc_answer' },
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

describe('ws-webrtc-answer handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should relay answer to other connections in room', async () => {
    mockQueryConnectionsByRoomId.mockResolvedValueOnce([
      { connectionId: 'conn-1', connectedAt: 0, ttl: 0 },
      { connectionId: 'conn-2', connectedAt: 0, ttl: 0 },
    ])
    mockSendToConnection.mockResolvedValue(undefined)

    const result = (await handler(
      createEvent('conn-2', { action: 'webrtc_answer', data: { roomId: 'room-1', sdp: 'v=0...' } }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(200)
    expect(mockSendToConnection).toHaveBeenCalledOnce()
    expect(mockSendToConnection).toHaveBeenCalledWith('conn-1', {
      type: 'webrtc_answer',
      data: { sdp: 'v=0...' },
    })
  })

  it('should return 400 for invalid body', async () => {
    const result = (await handler(
      createEvent('conn-1', { action: 'webrtc_answer', data: { roomId: 'room-1' } }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(400)
  })
})

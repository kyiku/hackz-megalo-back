import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { APIGatewayProxyResult, Context } from 'aws-lambda'

const { mockUpdateConnection } = vi.hoisted(() => ({
  mockUpdateConnection: vi.fn(),
}))

vi.mock('../../lib/dynamodb', () => ({
  updateConnection: (...args: unknown[]) => mockUpdateConnection(...args) as unknown,
}))

import { handler } from './handler'

const mockContext = {} as Context

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {}

const createEvent = (connectionId: string, body: unknown) =>
  ({
    requestContext: { connectionId, eventType: 'MESSAGE', routeKey: 'join_room' },
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

describe('ws-join-room handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should join room and return 200', async () => {
    mockUpdateConnection.mockResolvedValueOnce(undefined)

    const result = (await handler(
      createEvent('conn-1', { action: 'join_room', data: { roomId: 'room-1', role: 'phone' } }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(200)
    expect(mockUpdateConnection).toHaveBeenCalledWith('conn-1', {
      roomId: 'room-1',
      role: 'phone',
    })
  })

  it('should return 400 for invalid role', async () => {
    const result = (await handler(
      createEvent('conn-1', { action: 'join_room', data: { roomId: 'room-1', role: 'invalid' } }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(400)
  })

  it('should return 400 for missing body', async () => {
    const event = { ...createEvent('conn-1', {}), body: null } as Parameters<typeof handler>[0]

    const result = (await handler(event, mockContext, noop)) as APIGatewayProxyResult
    expect(result.statusCode).toBe(400)
  })

  it('should return 500 when DynamoDB fails', async () => {
    mockUpdateConnection.mockRejectedValueOnce(new Error('fail'))

    const result = (await handler(
      createEvent('conn-1', { action: 'join_room', data: { roomId: 'room-1', role: 'pc' } }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(500)
  })
})

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

const createSubscribeEvent = (connectionId: string, body: unknown) =>
  ({
    requestContext: {
      connectionId,
      eventType: 'MESSAGE',
      routeKey: 'subscribe',
    },
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

describe('ws-subscribe handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should subscribe connection to session and return 200', async () => {
    mockUpdateConnection.mockResolvedValueOnce(undefined)

    const result = (await handler(
      createSubscribeEvent('conn-123', { action: 'subscribe', data: { sessionId: '550e8400-e29b-41d4-a716-446655440000' } }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(200)
    expect(mockUpdateConnection).toHaveBeenCalledWith('conn-123', {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    })
  })

  it('should return 400 for invalid body', async () => {
    const result = (await handler(
      createSubscribeEvent('conn-123', { action: 'subscribe', data: {} }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(400)
  })

  it('should return 400 for missing body', async () => {
    const event = {
      ...createSubscribeEvent('conn-123', {}),
      body: null,
    } as Parameters<typeof handler>[0]

    const result = (await handler(event, mockContext, noop)) as APIGatewayProxyResult
    expect(result.statusCode).toBe(400)
  })

  it('should return 500 when DynamoDB fails', async () => {
    mockUpdateConnection.mockRejectedValueOnce(new Error('DynamoDB error'))

    const result = (await handler(
      createSubscribeEvent('conn-123', { action: 'subscribe', data: { sessionId: '550e8400-e29b-41d4-a716-446655440000' } }),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(500)
  })
})

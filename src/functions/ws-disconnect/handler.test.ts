import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { APIGatewayProxyResult, Context } from 'aws-lambda'

const { mockDeleteConnection } = vi.hoisted(() => ({
  mockDeleteConnection: vi.fn(),
}))

vi.mock('../../lib/dynamodb', () => ({
  deleteConnection: (...args: unknown[]) => mockDeleteConnection(...args) as unknown,
}))

import { handler } from './handler'

const mockContext = {} as Context

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {}

const createDisconnectEvent = (connectionId: string) =>
  ({
    requestContext: {
      connectionId,
      eventType: 'DISCONNECT',
    },
    body: null,
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

describe('ws-disconnect handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should delete connection and return 200', async () => {
    mockDeleteConnection.mockResolvedValueOnce(undefined)

    const result = (await handler(
      createDisconnectEvent('conn-123'),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(200)
    expect(mockDeleteConnection).toHaveBeenCalledWith('conn-123')
  })

  it('should return 500 when DynamoDB fails', async () => {
    mockDeleteConnection.mockRejectedValueOnce(new Error('DynamoDB error'))

    const result = (await handler(
      createDisconnectEvent('conn-123'),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(500)
  })
})

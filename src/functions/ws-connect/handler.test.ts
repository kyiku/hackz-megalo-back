import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { APIGatewayProxyResult, Context } from 'aws-lambda'

const { mockPutConnection } = vi.hoisted(() => ({
  mockPutConnection: vi.fn(),
}))

vi.mock('../../lib/dynamodb', () => ({
  putConnection: (...args: unknown[]) => mockPutConnection(...args) as unknown,
}))

import { handler } from './handler'

const mockContext = {} as Context

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {}

const createConnectEvent = (connectionId: string) =>
  ({
    requestContext: {
      connectionId,
      eventType: 'CONNECT',
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

describe('ws-connect handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should save connection and return 200', async () => {
    mockPutConnection.mockResolvedValueOnce(undefined)

    const result = (await handler(
      createConnectEvent('conn-123'),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(200)
    expect(mockPutConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-123',
      }),
    )
  })

  it('should return 500 when DynamoDB fails', async () => {
    mockPutConnection.mockRejectedValueOnce(new Error('DynamoDB error'))

    const result = (await handler(
      createConnectEvent('conn-123'),
      mockContext,
      noop,
    )) as APIGatewayProxyResult

    expect(result.statusCode).toBe(500)
  })
})

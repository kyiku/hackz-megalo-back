import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda'

const { mockPutSession, mockGeneratePresignedUploadUrl } = vi.hoisted(() => ({
  mockPutSession: vi.fn(),
  mockGeneratePresignedUploadUrl: vi.fn(),
}))

vi.mock('../../lib/dynamodb', () => ({
  putSession: (...args: unknown[]) => mockPutSession(...args) as unknown,
}))

vi.mock('../../lib/s3', () => ({
  generatePresignedUploadUrl: (...args: unknown[]) =>
    mockGeneratePresignedUploadUrl(...args) as unknown,
}))

vi.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}))

import { handler } from './handler'

const createEvent = (body: unknown): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/api/session',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
  }) as APIGatewayProxyEvent

const mockContext = {} as Context

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {}

const invoke = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const result = await handler(event, mockContext, noop)
  return result as APIGatewayProxyResult
}

describe('session-create handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WEBSOCKET_URL = 'wss://test.execute-api.ap-northeast-1.amazonaws.com/dev'
  })

  it('should create a session and return upload URLs', async () => {
    mockPutSession.mockResolvedValueOnce(undefined)
    mockGeneratePresignedUploadUrl.mockImplementation(
      (key: string) => Promise.resolve(`https://presigned/${key}`),
    )

    const event = createEvent({
      filterType: 'simple',
      filter: 'beauty',
      photoCount: 4,
    })

    const response = await invoke(event)
    expect(response.statusCode).toBe(201)

    const body = JSON.parse(response.body) as {
      sessionId: string
      uploadUrls: { index: number; url: string }[]
      websocketUrl: string
    }
    expect(body.sessionId).toBe('test-uuid-1234')
    expect(body.uploadUrls).toHaveLength(4)
    expect(body.uploadUrls[0]).toEqual({
      index: 1,
      url: 'https://presigned/originals/test-uuid-1234/1.jpg',
    })
    expect(body.websocketUrl).toBe(
      'wss://test.execute-api.ap-northeast-1.amazonaws.com/dev',
    )
  })

  it('should use default photoCount of 4', async () => {
    mockPutSession.mockResolvedValueOnce(undefined)
    mockGeneratePresignedUploadUrl.mockResolvedValue('https://presigned/url')

    const event = createEvent({
      filterType: 'simple',
      filter: 'natural',
    })

    const response = await invoke(event)
    const body = JSON.parse(response.body) as {
      uploadUrls: { index: number; url: string }[]
    }
    expect(body.uploadUrls).toHaveLength(4)
  })

  it('should save session to DynamoDB with correct attributes', async () => {
    mockPutSession.mockResolvedValueOnce(undefined)
    mockGeneratePresignedUploadUrl.mockResolvedValue('https://presigned/url')

    const event = createEvent({
      filterType: 'ai',
      filter: 'anime',
      photoCount: 2,
    })

    await invoke(event)

    expect(mockPutSession).toHaveBeenCalledOnce()
    expect(mockPutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'test-uuid-1234',
        filterType: 'ai',
        filter: 'anime',
        status: 'uploading',
        photoCount: 2,
      }),
    )
  })

  it('should return 400 for invalid body', async () => {
    const event = createEvent({
      filterType: 'invalid',
      filter: 'beauty',
    })

    const response = await invoke(event)
    expect(response.statusCode).toBe(400)
  })

  it('should return 400 for missing body', async () => {
    const event = { ...createEvent({}), body: null } as APIGatewayProxyEvent

    const response = await invoke(event)
    expect(response.statusCode).toBe(400)
  })

  it('should return 400 for malformed JSON body', async () => {
    const event = { ...createEvent({}), body: '{invalid json' } as APIGatewayProxyEvent

    const response = await invoke(event)
    expect(response.statusCode).toBe(400)

    const body = JSON.parse(response.body) as { error: string }
    expect(body.error).toBe('Invalid JSON in request body')
  })

  it('should return 500 when DynamoDB fails', async () => {
    mockPutSession.mockRejectedValueOnce(new Error('DynamoDB error'))
    mockGeneratePresignedUploadUrl.mockResolvedValue('https://presigned/url')

    const event = createEvent({
      filterType: 'simple',
      filter: 'mono',
      photoCount: 1,
    })

    const response = await invoke(event)
    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body)).toHaveProperty('error')
  })

  it('should return 500 when WEBSOCKET_URL is not set', async () => {
    delete process.env.WEBSOCKET_URL
    mockPutSession.mockResolvedValueOnce(undefined)
    mockGeneratePresignedUploadUrl.mockResolvedValue('https://presigned/url')

    const event = createEvent({
      filterType: 'simple',
      filter: 'beauty',
    })

    const response = await invoke(event)
    expect(response.statusCode).toBe(500)
  })
})

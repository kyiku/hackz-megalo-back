import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda'

const { mockGetSession, mockGeneratePresignedDownloadUrl } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGeneratePresignedDownloadUrl: vi.fn(),
}))

vi.mock('../../lib/dynamodb', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args) as unknown,
}))

vi.mock('../../lib/s3', () => ({
  generatePresignedDownloadUrl: (...args: unknown[]) =>
    mockGeneratePresignedDownloadUrl(...args) as unknown,
}))

import { handler } from './handler'

const createEvent = (sessionId: string): APIGatewayProxyEvent =>
  ({
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: `/api/session/${sessionId}`,
    pathParameters: { sessionId },
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

describe('session-get handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://presigned/download-url')
  })

  it('should return session with collageImageUrl when downloadKey exists', async () => {
    const session = {
      sessionId: 'test-uuid',
      createdAt: '2026-03-16T14:30:00Z',
      filterType: 'simple',
      filter: 'beauty',
      status: 'completed',
      photoCount: 4,
      caption: '楽しい思い出！',
      downloadCode: '12345',
      downloadKey: 'downloads/test-uuid.png',
      ttl: 0,
    }
    mockGetSession.mockResolvedValueOnce(session)

    const response = await invoke(createEvent('test-uuid'))
    expect(response.statusCode).toBe(200)

    const body = JSON.parse(response.body) as Record<string, unknown>
    expect(body.sessionId).toBe('test-uuid')
    expect(body.status).toBe('completed')
    expect(body.filterType).toBe('simple')
    expect(body.caption).toBe('楽しい思い出！')
    expect(body.downloadCode).toBe('12345')
    expect(body.collageImageUrl).toBe('https://presigned/download-url')
    expect(body.createdAt).toBe('2026-03-16T14:30:00Z')
  })

  it('should return downloadCode as undefined when not present in session', async () => {
    const session = {
      sessionId: 'test-uuid',
      createdAt: '2026-03-16T14:30:00Z',
      filterType: 'simple',
      filter: 'beauty',
      status: 'uploading',
      photoCount: 4,
      ttl: 0,
    }
    mockGetSession.mockResolvedValueOnce(session)

    const response = await invoke(createEvent('test-uuid'))
    const body = JSON.parse(response.body) as Record<string, unknown>

    expect(body.downloadCode).toBeUndefined()
  })

  it('should return session without collageImageUrl when not yet processed', async () => {
    const session = {
      sessionId: 'test-uuid',
      createdAt: '2026-03-16T14:30:00Z',
      filterType: 'simple',
      filter: 'beauty',
      status: 'uploading',
      photoCount: 4,
      ttl: 0,
    }
    mockGetSession.mockResolvedValueOnce(session)

    const response = await invoke(createEvent('test-uuid'))
    expect(response.statusCode).toBe(200)

    const body = JSON.parse(response.body) as Record<string, unknown>
    expect(body.sessionId).toBe('test-uuid')
    expect(body.status).toBe('uploading')
    expect(body.collageImageUrl).toBeUndefined()
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('should generate presigned URL with 1 hour expiry', async () => {
    const session = {
      sessionId: 'test-uuid',
      createdAt: '2026-03-16T14:30:00Z',
      filterType: 'simple',
      filter: 'beauty',
      status: 'completed',
      photoCount: 4,
      downloadKey: 'downloads/test-uuid.png',
      ttl: 0,
    }
    mockGetSession.mockResolvedValueOnce(session)

    await invoke(createEvent('test-uuid'))

    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'downloads/test-uuid.png',
      3600,
    )
  })

  it('should not expose internal fields like ttl or photoCount', async () => {
    const session = {
      sessionId: 'test-uuid',
      createdAt: '2026-03-16T14:30:00Z',
      filterType: 'simple',
      filter: 'beauty',
      status: 'uploading',
      photoCount: 4,
      ttl: 999999,
    }
    mockGetSession.mockResolvedValueOnce(session)

    const response = await invoke(createEvent('test-uuid'))
    const body = JSON.parse(response.body) as Record<string, unknown>

    expect(body).not.toHaveProperty('ttl')
    expect(body).not.toHaveProperty('photoCount')
    expect(body).not.toHaveProperty('downloadKey')
  })

  it('should return 404 when session not found', async () => {
    mockGetSession.mockResolvedValueOnce(undefined)

    const response = await invoke(createEvent('nonexistent'))
    expect(response.statusCode).toBe(404)

    const body = JSON.parse(response.body) as { error: string }
    expect(body.error).toBe('Session not found')
  })

  it('should return 400 when sessionId is missing', async () => {
    const event = {
      ...createEvent(''),
      pathParameters: null,
    } as unknown as APIGatewayProxyEvent

    const response = await invoke(event)
    expect(response.statusCode).toBe(400)
  })

  it('should return 500 when DynamoDB fails', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('DynamoDB error'))

    const response = await invoke(createEvent('test-uuid'))
    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body)).toHaveProperty('error')
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda'

const { mockGetSessionByDownloadCode, mockGeneratePresignedDownloadUrl } = vi.hoisted(() => ({
  mockGetSessionByDownloadCode: vi.fn(),
  mockGeneratePresignedDownloadUrl: vi.fn(),
}))

vi.mock('../../lib/dynamodb', () => ({
  getSessionByDownloadCode: (...args: unknown[]) =>
    mockGetSessionByDownloadCode(...args) as unknown,
}))

vi.mock('../../lib/s3', () => ({
  generatePresignedDownloadUrl: (...args: unknown[]) =>
    mockGeneratePresignedDownloadUrl(...args) as unknown,
}))

import { handler } from './handler'

const createEvent = (code: string | null): APIGatewayProxyEvent =>
  ({
    pathParameters: code ? { code } : null,
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: `/api/download/${code ?? ''}`,
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

const completedSession = {
  sessionId: 'test-uuid',
  createdAt: '2026-03-18T00:00:00.000Z',
  filterType: 'simple' as const,
  filter: 'beauty' as const,
  status: 'completed' as const,
  photoCount: 4,
  downloadCode: '38472',
  downloadKey: 'downloads/test-uuid.png',
  ttl: 9999999999,
}

describe('download-by-code handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return presigned download URL for valid code', async () => {
    mockGetSessionByDownloadCode.mockResolvedValueOnce(completedSession)
    mockGeneratePresignedDownloadUrl.mockResolvedValueOnce('https://s3.presigned/download')

    const response = await invoke(createEvent('38472'))
    expect(response.statusCode).toBe(200)

    const body = JSON.parse(response.body) as { downloadUrl: string; sessionId: string }
    expect(body.downloadUrl).toBe('https://s3.presigned/download')
    expect(body.sessionId).toBe('test-uuid')
  })

  it('should use downloadKey when available', async () => {
    mockGetSessionByDownloadCode.mockResolvedValueOnce(completedSession)
    mockGeneratePresignedDownloadUrl.mockResolvedValueOnce('https://s3.presigned/download')

    await invoke(createEvent('38472'))

    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'downloads/test-uuid.png',
      3600,
    )
  })

  it('should fall back to collageImageKey when downloadKey is absent', async () => {
    const sessionWithCollage = {
      ...completedSession,
      downloadKey: undefined,
      collageImageKey: 'collages/test-uuid.png',
    }
    mockGetSessionByDownloadCode.mockResolvedValueOnce(sessionWithCollage)
    mockGeneratePresignedDownloadUrl.mockResolvedValueOnce('https://s3.presigned/collage')

    const response = await invoke(createEvent('38472'))
    expect(response.statusCode).toBe(200)

    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      'collages/test-uuid.png',
      3600,
    )
  })

  it('should return 404 when code is not found', async () => {
    mockGetSessionByDownloadCode.mockResolvedValueOnce(undefined)

    const response = await invoke(createEvent('99999'))
    expect(response.statusCode).toBe(404)

    const body = JSON.parse(response.body) as { error: string }
    expect(body.error).toBe('Code not found')
  })

  it('should return 404 when image is not ready (no downloadKey or collageImageKey)', async () => {
    const processingSession = {
      ...completedSession,
      status: 'processing' as const,
      downloadKey: undefined,
      collageImageKey: undefined,
    }
    mockGetSessionByDownloadCode.mockResolvedValueOnce(processingSession)

    const response = await invoke(createEvent('38472'))
    expect(response.statusCode).toBe(404)

    const body = JSON.parse(response.body) as { error: string }
    expect(body.error).toBe('Image not ready')
  })

  it('should return 400 when code path parameter is missing', async () => {
    const response = await invoke(createEvent(null))
    expect(response.statusCode).toBe(400)
  })

  it('should use 1-hour expiry for presigned URL', async () => {
    mockGetSessionByDownloadCode.mockResolvedValueOnce(completedSession)
    mockGeneratePresignedDownloadUrl.mockResolvedValueOnce('https://s3.presigned/url')

    await invoke(createEvent('38472'))

    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      expect.any(String) as string,
      3600,
    )
  })
})

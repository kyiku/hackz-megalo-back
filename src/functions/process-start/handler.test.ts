import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda'

const { mockGetSession, mockUpdateSession, mockSfnSend } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockUpdateSession: vi.fn(),
  mockSfnSend: vi.fn(),
}))

vi.mock('../../lib/dynamodb', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args) as unknown,
  updateSession: (...args: unknown[]) => mockUpdateSession(...args) as unknown,
}))

vi.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: class {
    send = mockSfnSend
  },
  StartExecutionCommand: class {
    constructor(public input: unknown) {}
  },
}))

import { handler } from './handler'

const createEvent = (sessionId: string): APIGatewayProxyEvent =>
  ({
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: `/api/session/${sessionId}/process`,
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

const testSession = {
  sessionId: 'test-uuid',
  createdAt: '2026-03-16T14:30:00Z',
  filterType: 'simple',
  filter: 'beauty',
  status: 'uploading',
  photoCount: 4,
  ttl: 0,
}

describe('process-start handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STATE_MACHINE_ARN = 'arn:aws:states:ap-northeast-1:123:stateMachine:test'
    process.env.S3_BUCKET = 'test-bucket'
  })

  it('should start processing and return 202', async () => {
    mockGetSession.mockResolvedValueOnce(testSession)
    mockUpdateSession.mockResolvedValueOnce(undefined)
    mockSfnSend.mockResolvedValueOnce({ executionArn: 'arn:execution' })

    const response = await invoke(createEvent('test-uuid'))
    expect(response.statusCode).toBe(202)

    const body = JSON.parse(response.body) as { sessionId: string; status: string }
    expect(body.sessionId).toBe('test-uuid')
    expect(body.status).toBe('processing')
  })

  it('should update session status to processing', async () => {
    mockGetSession.mockResolvedValueOnce(testSession)
    mockUpdateSession.mockResolvedValueOnce(undefined)
    mockSfnSend.mockResolvedValueOnce({ executionArn: 'arn:execution' })

    await invoke(createEvent('test-uuid'))

    expect(mockUpdateSession).toHaveBeenCalledWith(
      'test-uuid',
      '2026-03-16T14:30:00Z',
      { status: 'processing' },
    )
  })

  it('should start Step Functions with correct input', async () => {
    mockGetSession.mockResolvedValueOnce(testSession)
    mockUpdateSession.mockResolvedValueOnce(undefined)
    mockSfnSend.mockResolvedValueOnce({ executionArn: 'arn:execution' })

    await invoke(createEvent('test-uuid'))

    expect(mockSfnSend).toHaveBeenCalledOnce()
  })

  it('should return 404 when session not found', async () => {
    mockGetSession.mockResolvedValueOnce(undefined)

    const response = await invoke(createEvent('nonexistent'))
    expect(response.statusCode).toBe(404)
  })

  it('should return 400 when sessionId is missing', async () => {
    const event = {
      ...createEvent(''),
      pathParameters: null,
    } as unknown as APIGatewayProxyEvent

    const response = await invoke(event)
    expect(response.statusCode).toBe(400)
  })

  it('should return 409 when session is not in uploading status', async () => {
    mockGetSession.mockResolvedValueOnce({ ...testSession, status: 'processing' })

    const response = await invoke(createEvent('test-uuid'))
    expect(response.statusCode).toBe(409)
  })

  it('should return 500 when STATE_MACHINE_ARN is not set', async () => {
    delete process.env.STATE_MACHINE_ARN
    mockGetSession.mockResolvedValueOnce(testSession)

    const response = await invoke(createEvent('test-uuid'))
    expect(response.statusCode).toBe(500)
  })

  it('should return 500 when Step Functions fails', async () => {
    mockGetSession.mockResolvedValueOnce(testSession)
    mockUpdateSession.mockResolvedValueOnce(undefined)
    mockSfnSend.mockRejectedValueOnce(new Error('SFN error'))

    const response = await invoke(createEvent('test-uuid'))
    expect(response.statusCode).toBe(500)
  })
})

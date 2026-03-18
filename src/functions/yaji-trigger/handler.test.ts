import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockLambdaSend, mockGetSession } = vi.hoisted(() => ({
  mockLambdaSend: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class {
    send = mockLambdaSend
  },
  InvokeCommand: class {
    constructor(public input: unknown) {}
  },
}))

vi.mock('../../lib/dynamodb', () => ({
  getSession: mockGetSession,
}))

vi.mock('../../utils/response', () => ({
  success: (body: unknown, status: number) => ({ statusCode: status, body: JSON.stringify(body) }),
  error: (msg: string, status: number) => ({ statusCode: status, body: JSON.stringify({ error: msg }) }),
}))

import { handler } from './handler'
import type { APIGatewayProxyEvent, Context } from 'aws-lambda'

const mockContext = {} as Context
// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {}

const makeEvent = (sessionId?: string): APIGatewayProxyEvent =>
  ({
    pathParameters: sessionId ? { sessionId } : null,
    body: null,
  }) as unknown as APIGatewayProxyEvent

interface InvokeInput {
  FunctionName: string
  InvocationType: string
  Payload: Uint8Array
}

describe('yaji-trigger handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.S3_BUCKET = 'test-bucket'
    process.env.YAJI_FAST_FUNCTION_NAME = 'yaji-comment-fast-fn'
    process.env.YAJI_DEEP_FUNCTION_NAME = 'yaji-comment-deep-fn'
    mockLambdaSend.mockResolvedValue({})
    mockGetSession.mockResolvedValue({
      sessionId: 'test-uuid',
      photoCount: 4,
      status: 'uploading',
    })
  })

  it('should invoke both yaji Lambdas and return 202', async () => {
    const res = await handler(makeEvent('test-uuid'), mockContext, noop)

    expect(res?.statusCode).toBe(202)
    expect(mockLambdaSend).toHaveBeenCalledTimes(2)
  })

  it('should invoke with correct payload including images array', async () => {
    await handler(makeEvent('test-uuid'), mockContext, noop)

    const rawCall = mockLambdaSend.mock.calls[0]?.[0] as { input: InvokeInput }
    const callInput = rawCall.input
    const payload = JSON.parse(new TextDecoder().decode(callInput.Payload)) as {
      sessionId: string
      bucket: string
      images: string[]
    }
    expect(payload.sessionId).toBe('test-uuid')
    expect(payload.bucket).toBe('test-bucket')
    expect(payload.images).toHaveLength(4)
    expect(payload.images[0]).toBe('originals/test-uuid/1.jpg')
  })

  it('should use Event invocation type for async fire-and-forget', async () => {
    await handler(makeEvent('test-uuid'), mockContext, noop)

    for (const call of mockLambdaSend.mock.calls) {
      const input = (call[0] as { input: InvokeInput }).input
      expect(input.InvocationType).toBe('Event')
    }
  })

  it('should return 400 when sessionId is missing', async () => {
    const res = await handler(makeEvent(), mockContext, noop)
    expect(res?.statusCode).toBe(400)
    expect(mockLambdaSend).not.toHaveBeenCalled()
  })

  it('should return 404 when session not found', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await handler(makeEvent('unknown'), mockContext, noop)
    expect(res?.statusCode).toBe(404)
    expect(mockLambdaSend).not.toHaveBeenCalled()
  })

  it('should return 500 when env vars are missing', async () => {
    delete process.env.S3_BUCKET
    const res = await handler(makeEvent('test-uuid'), mockContext, noop)
    expect(res?.statusCode).toBe(500)
  })
})

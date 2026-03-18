import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockGetSession, mockGeneratePresignedUploadUrl } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGeneratePresignedUploadUrl: vi.fn(),
}))

vi.mock('../../lib/dynamodb', () => ({ getSession: mockGetSession }))
vi.mock('../../lib/s3', () => ({ generatePresignedUploadUrl: mockGeneratePresignedUploadUrl }))
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
  ({ pathParameters: sessionId ? { sessionId } : null }) as unknown as APIGatewayProxyEvent

describe('yaji-frame-url handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ sessionId: 'test-uuid' })
    mockGeneratePresignedUploadUrl.mockResolvedValue('https://s3.example.com/presigned')
  })

  it('should return presigned upload URL with yaji-frames key', async () => {
    const res = await handler(makeEvent('test-uuid'), mockContext, noop)
    expect(res?.statusCode).toBe(200)
    const body = JSON.parse(res?.body ?? '{}') as { uploadUrl: string; key: string }
    expect(body.uploadUrl).toBe('https://s3.example.com/presigned')
    expect(body.key).toMatch(/^yaji-frames\/test-uuid\/\d+\.jpg$/)
  })

  it('should call generatePresignedUploadUrl with image/jpeg content type', async () => {
    await handler(makeEvent('test-uuid'), mockContext, noop)
    expect(mockGeneratePresignedUploadUrl).toHaveBeenCalledWith(
      expect.stringContaining('yaji-frames/test-uuid/'),
      'image/jpeg',
      60,
    )
  })

  it('should return 400 when sessionId is missing', async () => {
    const res = await handler(makeEvent(), mockContext, noop)
    expect(res?.statusCode).toBe(400)
  })

  it('should return 404 when session not found', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await handler(makeEvent('unknown'), mockContext, noop)
    expect(res?.statusCode).toBe(404)
  })
})

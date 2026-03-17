import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockDocClientSend } = vi.hoisted(() => ({
  mockDocClientSend: vi.fn(),
}))

vi.mock('@aws-sdk/client-dynamodb', () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  DynamoDBClient: class {},
}))

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockDocClientSend }),
  },
  UpdateCommand: class {
    constructor(public input: unknown) {}
  },
}))

import { handler } from './handler'
import type { DynamoDBStreamEvent, Context } from 'aws-lambda'

const mockContext = {} as Context

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {}

const createStreamEvent = (eventName: 'INSERT' | 'MODIFY' | 'REMOVE'): DynamoDBStreamEvent => ({
  Records: [
    {
      eventName,
      dynamodb: {
        NewImage: {
          sessionId: { S: 'test-uuid' },
          status: { S: 'completed' },
        },
      },
    },
  ],
})

describe('stats-update handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STATS_TABLE = 'test-stats'
    mockDocClientSend.mockResolvedValue(undefined)
  })

  it('should increment counter on INSERT', async () => {
    await handler(createStreamEvent('INSERT'), mockContext, noop)

    expect(mockDocClientSend).toHaveBeenCalledOnce()
  })

  it('should update counter on MODIFY', async () => {
    await handler(createStreamEvent('MODIFY'), mockContext, noop)

    expect(mockDocClientSend).toHaveBeenCalledOnce()
  })

  it('should skip REMOVE events', async () => {
    await handler(createStreamEvent('REMOVE'), mockContext, noop)

    expect(mockDocClientSend).not.toHaveBeenCalled()
  })

  it('should handle empty records', async () => {
    await handler({ Records: [] }, mockContext, noop)

    expect(mockDocClientSend).not.toHaveBeenCalled()
  })

  it('should fallback to DYNAMODB_TABLE when STATS_TABLE is not set', async () => {
    delete process.env.STATS_TABLE
    process.env.DYNAMODB_TABLE = 'test-sessions'

    await handler(createStreamEvent('INSERT'), mockContext, noop)

    expect(mockDocClientSend).toHaveBeenCalledOnce()
  })

  it('should skip when neither STATS_TABLE nor DYNAMODB_TABLE is set', async () => {
    delete process.env.STATS_TABLE
    delete process.env.DYNAMODB_TABLE

    await handler(createStreamEvent('INSERT'), mockContext, noop)

    expect(mockDocClientSend).not.toHaveBeenCalled()
  })

  it('should skip records with invalid status values', async () => {
    const event: DynamoDBStreamEvent = {
      Records: [
        {
          eventName: 'INSERT',
          dynamodb: {
            NewImage: {
              sessionId: { S: 'test-uuid' },
              status: { S: 'hacked_column' },
            },
          },
        },
      ],
    }

    await handler(event, mockContext, noop)

    expect(mockDocClientSend).not.toHaveBeenCalled()
  })

  it('should skip records with missing status', async () => {
    const event: DynamoDBStreamEvent = {
      Records: [
        {
          eventName: 'INSERT',
          dynamodb: {
            NewImage: {
              sessionId: { S: 'test-uuid' },
            },
          },
        },
      ],
    }

    await handler(event, mockContext, noop)

    expect(mockDocClientSend).not.toHaveBeenCalled()
  })
})

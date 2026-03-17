import { describe, expect, it } from 'vitest'
import type {
  Session,
  Connection,
  ProgressEvent,
  YajiComment,
  PipelineInput,
  SessionStatus,
  FilterType,
  Filter,
} from './types'

describe('types', () => {
  it('should allow creating a valid Session', () => {
    const session: Session = {
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
      createdAt: '2026-03-16T14:30:00Z',
      filterType: 'simple',
      filter: 'beauty',
      status: 'uploading',
      photoCount: 4,
      ttl: Math.floor(Date.now() / 1000) + 30 * 86400,
    }
    expect(session.sessionId).toBe('123e4567-e89b-12d3-a456-426614174000')
    expect(session.status).toBe('uploading')
  })

  it('should allow all session statuses', () => {
    const statuses: SessionStatus[] = [
      'uploading',
      'processing',
      'completed',
      'printed',
      'failed',
    ]
    expect(statuses).toHaveLength(5)
  })

  it('should allow all filter types', () => {
    const filterTypes: FilterType[] = ['simple', 'ai']
    expect(filterTypes).toHaveLength(2)
  })

  it('should allow all filters', () => {
    const filters: Filter[] = [
      'natural',
      'beauty',
      'bright',
      'mono',
      'sepia',
      'anime',
      'popart',
      'watercolor',
    ]
    expect(filters).toHaveLength(8)
  })

  it('should allow creating a valid Connection', () => {
    const conn: Connection = {
      connectionId: 'abc123',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
      roomId: 'room-1',
      role: 'phone',
      connectedAt: Date.now(),
      ttl: Math.floor(Date.now() / 1000) + 86400,
    }
    expect(conn.connectionId).toBe('abc123')
    expect(conn.role).toBe('phone')
  })

  it('should allow creating a ProgressEvent', () => {
    const event: ProgressEvent = {
      type: 'statusUpdate',
      data: {
        sessionId: 'test-id',
        status: 'processing',
        step: 'filter',
        progress: 50,
        message: 'フィルター適用中...',
      },
    }
    expect(event.type).toBe('statusUpdate')
    expect(event.data.progress).toBe(50)
  })

  it('should allow creating a YajiComment', () => {
    const comment: YajiComment = {
      type: 'yajiComment',
      data: {
        text: 'いい笑顔！',
        emotion: 'happy',
        lane: 'fast',
        timestamp: Date.now(),
      },
    }
    expect(comment.data.lane).toBe('fast')
  })

  it('should allow creating a PipelineInput', () => {
    const input: PipelineInput = {
      sessionId: 'test-id',
      filterType: 'simple',
      filter: 'mono',
      images: ['originals/test-id/1.jpg', 'originals/test-id/2.jpg'],
      bucket: 'receipt-purikura-dev',
    }
    expect(input.images).toHaveLength(2)
  })
})

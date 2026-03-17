import { describe, expect, it } from 'vitest'
import {
  CreateSessionSchema,
  ProcessSchema,
  SubscribeSchema,
  JoinRoomSchema,
  WebrtcSdpSchema,
  WebrtcIceSchema,
  ShootingSyncSchema,
} from './validation'

describe('CreateSessionSchema', () => {
  it('should accept valid simple filter input', () => {
    const result = CreateSessionSchema.safeParse({
      filterType: 'simple',
      filter: 'beauty',
      photoCount: 4,
    })
    expect(result.success).toBe(true)
  })

  it('should accept valid AI filter input', () => {
    const result = CreateSessionSchema.safeParse({
      filterType: 'ai',
      filter: 'anime',
      photoCount: 4,
    })
    expect(result.success).toBe(true)
  })

  it('should default photoCount to 4', () => {
    const result = CreateSessionSchema.parse({
      filterType: 'simple',
      filter: 'mono',
    })
    expect(result.photoCount).toBe(4)
  })

  it('should reject invalid filterType', () => {
    const result = CreateSessionSchema.safeParse({
      filterType: 'invalid',
      filter: 'beauty',
    })
    expect(result.success).toBe(false)
  })

  it('should reject invalid filter name', () => {
    const result = CreateSessionSchema.safeParse({
      filterType: 'simple',
      filter: 'nonexistent',
    })
    expect(result.success).toBe(false)
  })

  it('should reject photoCount > 4', () => {
    const result = CreateSessionSchema.safeParse({
      filterType: 'simple',
      filter: 'beauty',
      photoCount: 5,
    })
    expect(result.success).toBe(false)
  })

  it('should reject photoCount < 1', () => {
    const result = CreateSessionSchema.safeParse({
      filterType: 'simple',
      filter: 'beauty',
      photoCount: 0,
    })
    expect(result.success).toBe(false)
  })
})

describe('ProcessSchema', () => {
  it('should accept a valid UUID', () => {
    const result = ProcessSchema.safeParse({
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    })
    expect(result.success).toBe(true)
  })

  it('should reject non-UUID strings', () => {
    const result = ProcessSchema.safeParse({ sessionId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })
})

describe('SubscribeSchema', () => {
  it('should accept a valid UUID', () => {
    const result = SubscribeSchema.safeParse({
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    })
    expect(result.success).toBe(true)
  })
})

describe('JoinRoomSchema', () => {
  it('should accept valid input', () => {
    const result = JoinRoomSchema.safeParse({
      roomId: 'session-123',
      role: 'phone',
    })
    expect(result.success).toBe(true)
  })

  it('should reject invalid role', () => {
    const result = JoinRoomSchema.safeParse({
      roomId: 'session-123',
      role: 'tablet',
    })
    expect(result.success).toBe(false)
  })
})

describe('WebrtcSdpSchema', () => {
  it('should accept valid SDP', () => {
    const result = WebrtcSdpSchema.safeParse({
      roomId: 'room-1',
      sdp: 'v=0\r\n...',
    })
    expect(result.success).toBe(true)
  })

  it('should reject empty sdp', () => {
    const result = WebrtcSdpSchema.safeParse({
      roomId: 'room-1',
      sdp: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('WebrtcIceSchema', () => {
  it('should accept valid ICE candidate', () => {
    const result = WebrtcIceSchema.safeParse({
      roomId: 'room-1',
      candidate: 'candidate:...',
    })
    expect(result.success).toBe(true)
  })
})

describe('ShootingSyncSchema', () => {
  it('should accept shooting_start event', () => {
    const result = ShootingSyncSchema.safeParse({
      roomId: 'room-1',
      event: 'shooting_start',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
      totalPhotos: 4,
    })
    expect(result.success).toBe(true)
  })

  it('should accept countdown event', () => {
    const result = ShootingSyncSchema.safeParse({
      roomId: 'room-1',
      event: 'countdown',
      photoIndex: 1,
      count: 3,
    })
    expect(result.success).toBe(true)
  })

  it('should reject invalid event type', () => {
    const result = ShootingSyncSchema.safeParse({
      roomId: 'room-1',
      event: 'invalid_event',
    })
    expect(result.success).toBe(false)
  })
})

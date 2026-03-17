import { z } from 'zod'

export const CreateSessionSchema = z.object({
  filterType: z.enum(['simple', 'ai']),
  filter: z.enum([
    'natural',
    'beauty',
    'bright',
    'mono',
    'sepia',
    'anime',
    'popart',
    'watercolor',
  ]),
  photoCount: z.number().int().min(1).max(4).default(4),
})

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>

export const ProcessSchema = z.object({
  sessionId: z.uuid(),
})

export type ProcessInput = z.infer<typeof ProcessSchema>

export const SubscribeSchema = z.object({
  sessionId: z.uuid(),
})

export const JoinRoomSchema = z.object({
  roomId: z.string().min(1),
  role: z.enum(['phone', 'pc']),
})

export const WebrtcSdpSchema = z.object({
  roomId: z.string().min(1),
  sdp: z.string().min(1),
})

export const WebrtcIceSchema = z.object({
  roomId: z.string().min(1),
  candidate: z.string().min(1),
})

export const ShootingSyncSchema = z.object({
  roomId: z.string().min(1),
  event: z.enum(['shooting_start', 'countdown', 'shutter', 'shooting_complete']),
  sessionId: z.string().optional(),
  totalPhotos: z.number().optional(),
  photoIndex: z.number().optional(),
  count: z.number().optional(),
})

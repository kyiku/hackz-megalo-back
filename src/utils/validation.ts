import { z } from 'zod'

const SIMPLE_FILTERS = ['natural', 'beauty', 'bright', 'mono', 'sepia'] as const
const AI_FILTERS = ['anime', 'popart', 'watercolor'] as const

export const CreateSessionSchema = z.object({
  filterType: z.enum(['simple', 'ai']),
  filter: z.enum([...SIMPLE_FILTERS, ...AI_FILTERS]),
  photoCount: z.number().int().min(1).max(4).default(4),
}).superRefine((data, ctx) => {
  const isSimple = data.filterType === 'simple'
  const validFilters = isSimple ? SIMPLE_FILTERS : AI_FILTERS
  if (!(validFilters as readonly string[]).includes(data.filter)) {
    ctx.addIssue({
      code: 'custom',
      message: `filter '${data.filter}' is not valid for filterType '${data.filterType}'`,
      path: ['filter'],
    })
  }
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
  event: z.enum(['shooting_start', 'countdown', 'shutter', 'shooting_complete', 'phase_change', 'filter_select', 'doodle_sync', 'ar_sync', 'photo_sync']),
  sessionId: z.string().optional(),
  totalPhotos: z.number().optional(),
  photoIndex: z.number().optional(),
  count: z.number().optional(),
  phase: z.string().optional(),
  filterId: z.string().optional(),
  layers: z.string().optional(),
  effect: z.string().nullable().optional(),
  photos: z.array(z.string()).optional(),
  photoData: z.string().optional(),
  photoCount: z.number().optional(),
})

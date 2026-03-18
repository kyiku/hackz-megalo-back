/** Session status lifecycle */
export type SessionStatus =
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'printed'
  | 'failed'

/** Simple filter types applied via sharp */
export type SimpleFilter = 'natural' | 'beauty' | 'bright' | 'mono' | 'sepia'

/** AI style transfer types via Stability AI */
export type AiFilter = 'anime' | 'popart' | 'watercolor'

/** Filter category */
export type FilterType = 'simple' | 'ai'

/** All available filters */
export type Filter = SimpleFilter | AiFilter

/** DynamoDB sessions table record */
export interface Session {
  readonly sessionId: string
  readonly createdAt: string
  readonly filterType: FilterType
  readonly filter: Filter
  readonly status: SessionStatus
  readonly photoCount: number
  readonly downloadCode?: string
  readonly caption?: string
  readonly sentiment?: string
  readonly sentimentScore?: number
  readonly originalImageKeys?: readonly string[]
  readonly filteredImageKeys?: readonly string[]
  readonly collageImageKey?: string
  readonly printImageKey?: string
  readonly downloadKey?: string
  readonly ttl: number
}

/** DynamoDB connections table record */
export interface Connection {
  readonly connectionId: string
  readonly sessionId?: string
  readonly roomId?: string
  readonly role?: 'phone' | 'pc'
  readonly connectedAt: number
  readonly ttl: number
}

/** Generic API response wrapper */
export interface ApiResponse<T> {
  readonly statusCode: number
  readonly body: T
}

/** WebSocket progress event sent to clients */
export interface ProgressEvent {
  readonly type: 'statusUpdate'
  readonly data: {
    readonly sessionId: string
    readonly status: SessionStatus
    readonly step: string
    readonly progress: number
    readonly message: string
  }
}

/** Yaji comment event sent to clients */
export interface YajiComment {
  readonly type: 'yajiComment'
  readonly data: {
    readonly text: string
    readonly emotion: string
    readonly lane: 'fast' | 'deep'
    readonly timestamp: number
  }
}

/** Step Functions pipeline input */
export interface PipelineInput {
  readonly sessionId: string
  readonly createdAt: string
  readonly filterType: FilterType
  readonly filter: Filter
  readonly images: readonly string[]
  readonly bucket: string
}

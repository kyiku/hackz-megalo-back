import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockSend, mockGetSignedUrl } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mockSend
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args) as unknown,
}))

import {
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  getObject,
  putObject,
  bucketName,
} from './s3'

describe('s3', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.S3_BUCKET = 'test-bucket'
  })

  describe('generatePresignedUploadUrl', () => {
    it('should generate a presigned upload URL', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://presigned-upload-url')
      const url = await generatePresignedUploadUrl('originals/test/1.jpg')
      expect(url).toBe('https://presigned-upload-url')
      expect(mockGetSignedUrl).toHaveBeenCalledOnce()
    })
  })

  describe('generatePresignedDownloadUrl', () => {
    it('should generate a presigned download URL', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://presigned-download-url')
      const url = await generatePresignedDownloadUrl('collages/test.png')
      expect(url).toBe('https://presigned-download-url')
    })
  })

  describe('getObject', () => {
    it('should return buffer from S3', async () => {
      const bytes = new Uint8Array([1, 2, 3])
      mockSend.mockResolvedValueOnce({
        Body: { transformToByteArray: () => Promise.resolve(bytes) },
      })
      const result = await getObject('test-key')
      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result).toEqual(Buffer.from(bytes))
    })

    it('should throw when body is empty', async () => {
      mockSend.mockResolvedValueOnce({ Body: undefined })
      await expect(getObject('empty-key')).rejects.toThrow('Empty body')
    })
  })

  describe('putObject', () => {
    it('should put a buffer to S3', async () => {
      mockSend.mockResolvedValueOnce({})
      await putObject('test-key', Buffer.from([1, 2, 3]))
      expect(mockSend).toHaveBeenCalledOnce()
    })
  })

  describe('bucketName', () => {
    it('should return the bucket name from env', () => {
      expect(bucketName()).toBe('test-bucket')
    })

    it('should throw when S3_BUCKET is not set', () => {
      delete process.env.S3_BUCKET
      expect(() => bucketName()).toThrow('S3_BUCKET is not set')
    })
  })
})

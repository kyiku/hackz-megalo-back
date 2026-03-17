import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { success, error } from './response'

describe('response', () => {
  const originalAllowedOrigin = process.env.ALLOWED_ORIGIN

  afterEach(() => {
    if (originalAllowedOrigin === undefined) {
      delete process.env.ALLOWED_ORIGIN
    } else {
      process.env.ALLOWED_ORIGIN = originalAllowedOrigin
    }
  })

  describe('success', () => {
    beforeEach(() => {
      delete process.env.ALLOWED_ORIGIN
    })

    it('should return 200 with JSON body by default', () => {
      const result = success({ message: 'ok' })
      expect(result.statusCode).toBe(200)
      expect(JSON.parse(result.body)).toEqual({ message: 'ok' })
      expect(result.headers?.['Content-Type']).toBe('application/json')
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*')
    })

    it('should accept a custom status code', () => {
      const result = success({ sessionId: 'abc' }, 201)
      expect(result.statusCode).toBe(201)
      expect(JSON.parse(result.body)).toEqual({ sessionId: 'abc' })
    })
  })

  describe('error', () => {
    it('should return 500 with error message by default', () => {
      const result = error('Something went wrong')
      expect(result.statusCode).toBe(500)
      expect(JSON.parse(result.body)).toEqual({
        error: 'Something went wrong',
      })
    })

    it('should accept a custom status code', () => {
      const result = error('Not found', 404)
      expect(result.statusCode).toBe(404)
      expect(JSON.parse(result.body)).toEqual({ error: 'Not found' })
    })

    it('should include CORS headers', () => {
      const result = error('Bad request', 400)
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*')
    })
  })

  describe('ALLOWED_ORIGIN', () => {
    it('should use ALLOWED_ORIGIN env var when set', () => {
      process.env.ALLOWED_ORIGIN = 'https://receipt-purikura.example.com'

      const result = success({ ok: true })
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('https://receipt-purikura.example.com')
    })

    it('should fallback to * when ALLOWED_ORIGIN is not set', () => {
      delete process.env.ALLOWED_ORIGIN

      const result = success({ ok: true })
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*')
    })
  })
})

import { describe, expect, it } from 'vitest'
import { success, error } from './response'

describe('response', () => {
  describe('success', () => {
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
})

import type { APIGatewayProxyResult } from 'aws-lambda'

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
} as const

/** Build a successful API Gateway response. */
export const success = (data: unknown, statusCode = 200): APIGatewayProxyResult => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(data),
})

/** Build an error API Gateway response. */
export const error = (message: string, statusCode = 500): APIGatewayProxyResult => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify({ error: message }),
})

import type { APIGatewayProxyResult } from 'aws-lambda'

const getCorsHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
})

/** Build a successful API Gateway response. */
export const success = (data: unknown, statusCode = 200): APIGatewayProxyResult => ({
  statusCode,
  headers: getCorsHeaders(),
  body: JSON.stringify(data),
})

/** Build an error API Gateway response. */
export const error = (message: string, statusCode = 500): APIGatewayProxyResult => ({
  statusCode,
  headers: getCorsHeaders(),
  body: JSON.stringify({ error: message }),
})

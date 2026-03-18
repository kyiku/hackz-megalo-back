import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import type { Session, Connection } from './types'

const client = new DynamoDBClient({})
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const sessionsTable = (): string => {
  const name = process.env.DYNAMODB_TABLE
  if (!name) throw new Error('DYNAMODB_TABLE is not set')
  return name
}

export const getSession = async (
  sessionId: string,
): Promise<Session | undefined> => {
  // sessions table uses sessionId as PK and createdAt as SK.
  // To fetch by sessionId alone we query the partition key.
  const result = await docClient.send(
    new QueryCommand({
      TableName: sessionsTable(),
      KeyConditionExpression: 'sessionId = :sid',
      ExpressionAttributeValues: { ':sid': sessionId },
      Limit: 1,
      ScanIndexForward: false,
    }),
  )
  return result.Items?.[0] as Session | undefined
}

export const getSessionByDownloadCode = async (
  downloadCode: string,
): Promise<Session | undefined> => {
  const result = await docClient.send(
    new QueryCommand({
      TableName: sessionsTable(),
      IndexName: 'downloadCode-index',
      KeyConditionExpression: 'downloadCode = :code',
      ExpressionAttributeValues: { ':code': downloadCode },
      Limit: 1,
    }),
  )
  return result.Items?.[0] as Session | undefined
}

export const putSession = async (session: Session): Promise<void> => {
  await docClient.send(
    new PutCommand({
      TableName: sessionsTable(),
      Item: session,
    }),
  )
}

const ALLOWED_SESSION_FIELDS = new Set([
  'status',
  'caption',
  'sentiment',
  'sentimentScore',
  'originalImageKeys',
  'filteredImageKeys',
  'collageImageKey',
  'printImageKey',
  'downloadKey',
])

export const updateSession = async (
  sessionId: string,
  createdAt: string,
  updates: Record<string, unknown>,
): Promise<void> => {
  const entries = Object.entries(updates).filter(([key]) => ALLOWED_SESSION_FIELDS.has(key))
  if (entries.length === 0) return

  const expressionParts: string[] = []
  const names: Record<string, string> = {}
  const values: Record<string, unknown> = {}

  for (const [key, value] of entries) {
    const nameKey = `#${key}`
    const valueKey = `:${key}`
    expressionParts.push(`${nameKey} = ${valueKey}`)
    names[nameKey] = key
    values[valueKey] = value
  }

  await docClient.send(
    new UpdateCommand({
      TableName: sessionsTable(),
      Key: { sessionId, createdAt },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  )
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

const connectionsTable = (): string => {
  const name = process.env.CONNECTIONS_TABLE
  if (!name) throw new Error('CONNECTIONS_TABLE is not set')
  return name
}

export const putConnection = async (connection: Connection): Promise<void> => {
  await docClient.send(
    new PutCommand({
      TableName: connectionsTable(),
      Item: connection,
    }),
  )
}

export const deleteConnection = async (
  connectionId: string,
): Promise<void> => {
  await docClient.send(
    new DeleteCommand({
      TableName: connectionsTable(),
      Key: { connectionId },
    }),
  )
}

export const updateConnection = async (
  connectionId: string,
  updates: Record<string, unknown>,
): Promise<void> => {
  const entries = Object.entries(updates)
  if (entries.length === 0) return

  const expressionParts: string[] = []
  const names: Record<string, string> = {}
  const values: Record<string, unknown> = {}

  for (const [key, value] of entries) {
    const nameKey = `#${key}`
    const valueKey = `:${key}`
    expressionParts.push(`${nameKey} = ${valueKey}`)
    names[nameKey] = key
    values[valueKey] = value
  }

  await docClient.send(
    new UpdateCommand({
      TableName: connectionsTable(),
      Key: { connectionId },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  )
}

export const queryConnectionsBySessionId = async (
  sessionId: string,
): Promise<Connection[]> => {
  const result = await docClient.send(
    new QueryCommand({
      TableName: connectionsTable(),
      IndexName: 'sessionId-index',
      KeyConditionExpression: 'sessionId = :sid',
      ExpressionAttributeValues: { ':sid': sessionId },
    }),
  )
  return (result.Items ?? []) as Connection[]
}

export const queryConnectionsByRoomId = async (
  roomId: string,
): Promise<Connection[]> => {
  const result = await docClient.send(
    new QueryCommand({
      TableName: connectionsTable(),
      IndexName: 'roomId-index',
      KeyConditionExpression: 'roomId = :rid',
      ExpressionAttributeValues: { ':rid': roomId },
    }),
  )
  return (result.Items ?? []) as Connection[]
}

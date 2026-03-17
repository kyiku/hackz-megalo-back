import type { DynamoDBStreamHandler } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

export const handler: DynamoDBStreamHandler = async (event) => {
  const tableName = process.env.STATS_TABLE ?? process.env.DYNAMODB_TABLE
  if (!tableName) return

  const VALID_STATUSES = new Set(['uploading', 'processing', 'completed', 'printed', 'failed'])

  for (const record of event.Records) {
    if (record.eventName === 'REMOVE') continue

    const rawStatus = record.dynamodb?.NewImage?.status?.S
    if (!rawStatus || !VALID_STATUSES.has(rawStatus)) continue

    const status = rawStatus
    const today = new Date().toISOString().slice(0, 10)

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { date: today },
        UpdateExpression:
          'SET totalSessions = if_not_exists(totalSessions, :zero) + :one, ' +
          `#status = if_not_exists(#status, :zero) + :one`,
        ExpressionAttributeNames: { '#status': status },
        ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
      }),
    )
  }
}

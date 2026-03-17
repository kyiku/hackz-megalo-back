import type { DynamoDBStreamHandler } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

export const handler: DynamoDBStreamHandler = async (event) => {
  const tableName = process.env.STATS_TABLE ?? process.env.DYNAMODB_TABLE
  if (!tableName) return

  for (const record of event.Records) {
    if (record.eventName === 'REMOVE') continue

    const status = record.dynamodb?.NewImage?.status?.S ?? 'unknown'
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

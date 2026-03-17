import type { DynamoDBStreamHandler } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb'

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const VALID_STATUSES = new Set(['uploading', 'processing', 'completed', 'printed', 'failed'])

/** Call AppSync publishStats mutation to trigger subscriptions. */
const publishToAppSync = async (stats: {
  totalSessions: number
  completedSessions: number
  failedSessions: number
}): Promise<void> => {
  const apiUrl = process.env.APPSYNC_URL
  const apiKey = process.env.APPSYNC_API_KEY
  if (!apiUrl || !apiKey) return

  const query = `mutation PublishStats($input: StatsInput!) {
    publishStats(input: $input) { totalSessions completedSessions failedSessions lastUpdated }
  }`

  try {
    await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query,
        variables: { input: stats },
      }),
    })
  } catch (err) {
    console.error('AppSync publishStats failed:', err)
  }
}

export const handler: DynamoDBStreamHandler = async (event) => {
  const tableName = process.env.STATS_TABLE ?? process.env.DYNAMODB_TABLE
  if (!tableName) return

  let updated = false

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
    updated = true
  }

  // Publish aggregated stats to AppSync for real-time dashboard
  if (updated) {
    const today = new Date().toISOString().slice(0, 10)
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { date: today },
        }),
      )
      const item = result.Item ?? {}
      await publishToAppSync({
        totalSessions: Number(item.totalSessions) || 0,
        completedSessions: (Number(item.completed) || 0) + (Number(item.printed) || 0),
        failedSessions: Number(item.failed) || 0,
      })
    } catch (err) {
      console.error('Failed to read stats for AppSync publish:', err)
    }
  }
}

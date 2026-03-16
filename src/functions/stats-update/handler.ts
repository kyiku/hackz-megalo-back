import type { DynamoDBStreamHandler } from 'aws-lambda'

export const handler: DynamoDBStreamHandler = async (_event) => {
  await Promise.resolve()
  // TODO: implement stats update
}

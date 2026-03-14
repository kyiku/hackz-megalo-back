import type { Handler } from 'aws-lambda'

export const handler: Handler = async (event) => {
  return { ...event, status: 'TODO: implement' }
}

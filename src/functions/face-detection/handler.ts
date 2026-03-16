export const handler = async (_event: Record<string, unknown>): Promise<Record<string, unknown>> => {
  await Promise.resolve()
  return { ..._event, status: 'TODO: implement' }
}

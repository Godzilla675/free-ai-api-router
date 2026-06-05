export function toSseErrorEvent(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `event: error\ndata: ${JSON.stringify({ error: { message, type: 'server_error', code: 'stream_error' } })}\n\n`;
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    const entry: Record<string, unknown> = {
      level: 'info',
      timestamp: new Date().toISOString(),
      message,
    };
    if (meta) {
      entry.meta = meta;
    }
    process.stdout.write(JSON.stringify(entry) + '\n');
  },

  error(message: string, error?: unknown): void {
    const entry: Record<string, unknown> = {
      level: 'error',
      timestamp: new Date().toISOString(),
      message,
    };
    if (error !== undefined) {
      entry.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    }
    process.stderr.write(JSON.stringify(entry) + '\n');
  }
};

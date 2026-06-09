export interface Logger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export const defaultLogger: Logger = {
  info: (message: string, ...args: unknown[]) => console.log(message, ...args),
  error: (message: string, ...args: unknown[]) => console.error(message, ...args),
  warn: (message: string, ...args: unknown[]) => console.warn(message, ...args),
  debug: (message: string, ...args: unknown[]) => console.debug(message, ...args),
};

let currentLogger: Logger = defaultLogger;

export function setLogger(newLogger: Logger): void {
  currentLogger = newLogger;
}

export const logger: Logger = {
  info: (message: string, ...args: unknown[]) => currentLogger.info(message, ...args),
  error: (message: string, ...args: unknown[]) => currentLogger.error(message, ...args),
  warn: (message: string, ...args: unknown[]) => currentLogger.warn(message, ...args),
  debug: (message: string, ...args: unknown[]) => currentLogger.debug(message, ...args),
};

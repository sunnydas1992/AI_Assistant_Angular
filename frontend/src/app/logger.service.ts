import { Injectable } from '@angular/core';

const PREFIX = '[QA Assistant]';

/**
 * Central logging for the frontend. Use for debugging and tracing events.
 * In development, logs go to the browser console. Can be extended to send errors to the backend.
 */
@Injectable({ providedIn: 'root' })
export class LoggerService {
  debug(message: string, ...args: unknown[]): void {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(`${PREFIX} ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (typeof console !== 'undefined' && console.info) {
      console.info(`${PREFIX} ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`${PREFIX} ${message}`, ...args);
    }
  }

  error(message: string, error?: unknown, ...args: unknown[]): void {
    if (typeof console !== 'undefined' && console.error) {
      console.error(`${PREFIX} ${message}`, error ?? '', ...args);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
  }
}

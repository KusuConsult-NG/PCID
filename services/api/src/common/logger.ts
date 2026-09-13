type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured JSON logging.
 *
 * Operator logs are not an audit trail and must not become a second, unguarded
 * copy of citizen data: log call sites pass identifiers and outcomes, never
 * record contents. The audit table is where access to data is recorded (§25).
 */
class Logger {
  private threshold: number = LEVEL_ORDER.info;

  setLevel(level: Level): void {
    this.threshold = LEVEL_ORDER[level];
  }

  private write(level: Level, event: string, fields: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.threshold) return;
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    });
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  debug(event: string, fields: Record<string, unknown> = {}): void {
    this.write('debug', event, fields);
  }
  info(event: string, fields: Record<string, unknown> = {}): void {
    this.write('info', event, fields);
  }
  warn(event: string, fields: Record<string, unknown> = {}): void {
    this.write('warn', event, fields);
  }
  error(event: string, fields: Record<string, unknown> = {}): void {
    this.write('error', event, fields);
  }
}

export const logger = new Logger();

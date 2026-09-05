/**
 * Structured JSON logging.
 *
 * Vercel/CloudWatch parse one JSON object per line, which makes fields
 * queryable. Anything that looks like a secret is redacted before it reaches
 * the log sink — logs are frequently exported to third-party tools.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'apikey',
  'api_key',
  'cardnumber',
  'cvv',
  'cvc',
  'pan',
  'client_secret',
  'stripe_secret_key',
  'integritysalt',
  'hashkey',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[max-depth]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function currentLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? 'info') as Level;
  return raw in LEVEL_WEIGHT ? raw : 'info';
}

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel()]) return;

  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),

  /** Times an async operation and logs its duration. Rethrows on failure. */
  async timed<T>(
    message: string,
    fn: () => Promise<T>,
    context?: Record<string, unknown>,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      emit('info', message, { ...context, durationMs: Date.now() - start, ok: true });
      return result;
    } catch (error) {
      emit('error', message, { ...context, durationMs: Date.now() - start, ok: false, error });
      throw error;
    }
  },
};

export { redact as redactForLogging };

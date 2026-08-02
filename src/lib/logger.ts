/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Structured logging
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What was here before ──────────────────────────────────────────────────
 *
 *  Twelve `console.*` calls in two hundred and eighty-one files, and no logger.
 *  Route handlers returned errors to the client and wrote nothing at all, so a
 *  500 in production was known only to the person who hit it. The review put it
 *  plainly: you learn about outages from customers, and you cannot answer "is
 *  this everyone or one tenant", "when did it start", or "did the deploy cause
 *  it".
 *
 *  ── What this is, and what it deliberately is not ─────────────────────────
 *
 *  It is a formatter and a redactor in front of `console`. It is not a
 *  transport, not a buffer, not an agent, and it opens no sockets.
 *
 *  That is the whole design. Every host worth deploying to — Vercel, Fly,
 *  ECS, a systemd unit — already collects stdout and ships it somewhere. A
 *  logger that does its own shipping duplicates that, and then owns a queue
 *  that can fill up, a retry loop that can spin, and a failure mode where the
 *  logger takes down the process it was installed to observe. Writing a line of
 *  JSON to stdout has none of those.
 *
 *  ── The seam for an external provider ─────────────────────────────────────
 *
 *  `setLogSink()`. Sentry, Datadog or OpenTelemetry attach there, in one file,
 *  without a single call site changing — and because the sink receives an
 *  already-redacted record, adding a provider cannot become the thing that
 *  starts sending customer email addresses to a third party.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Anything a log line carries besides its message. */
export type LogFields = Record<string, unknown>;

export interface LogRecord extends LogFields {
  level: LogLevel;
  /** ISO 8601, UTC. Sorts lexically, which is what a log search needs. */
  time: string;
  message: string;
  environment: string;
  /** Correlates every line written while serving one request. */
  requestId?: string;
}

// ── Configuration ──────────────────────────────────────────────────────────

const ENVIRONMENT = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? 'development';
const IS_PRODUCTION = ENVIRONMENT === 'production';

/**
 * Below this, nothing is written.
 *
 * `debug` in development because that is where it is read by a person, `info`
 * in production because that is where volume costs money and drowns signal.
 */
const THRESHOLD: number = (() => {
  const configured = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (configured && configured in LEVEL_ORDER) return LEVEL_ORDER[configured];
  return IS_PRODUCTION ? LEVEL_ORDER.info : LEVEL_ORDER.debug;
})();

/**
 * JSON where a machine reads it, prose where a person does.
 *
 * A developer staring at a terminal is not helped by a hundred-character JSON
 * object per line, and a log aggregator cannot parse prose. Neither format is
 * correct everywhere, so the environment picks — and `LOG_FORMAT` overrides it
 * for the case this guesses wrong.
 */
const AS_JSON = (process.env.LOG_FORMAT ?? (IS_PRODUCTION ? 'json' : 'pretty')) === 'json';

// ── Redaction ──────────────────────────────────────────────────────────────

/**
 * Field names whose values never reach a log line.
 *
 * Matched on the key rather than sniffed from the value, because a value-based
 * guess fails in both directions — it will not recognise an opaque token and it
 * will mangle a legitimate string that happens to look like one.
 *
 * `email` is on this list. It is genuinely useful for support and it is
 * personal data, and the instruction is not ambiguous: user *ids* are logged
 * instead, which answer "which account" without putting a customer's address
 * into a third-party system that has its own retention policy.
 */
const REDACTED_KEYS =
  /pass(word|phrase)?|secret|token|cookie|authorization|auth|jwt|credential|api[-_]?key|session|email|refresh|bearer|signature/i;

const REDACTED = '[redacted]';

/** Long strings are truncated: one runaway field must not become the log. */
const MAX_STRING = 2_000;
const MAX_DEPTH = 6;

function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[truncated: too deep]';

  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… [truncated]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;

  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    // A page of results has no business in a log line; the count does.
    if (value.length > 50) return `[array of ${value.length}]`;
    return value.map(v => redact(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.test(key) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }

  return String(value);
}

/**
 * An exception, as fields.
 *
 * `JSON.stringify(new Error('x'))` is `{}` — message and stack are
 * non-enumerable — so an error passed through a JSON logger without this
 * silently becomes an empty object. That is the failure this function exists to
 * prevent, and it is one people discover during the incident.
 *
 * The stack is kept in full. It goes to stdout, never to a client: the
 * distinction the review asked for is between what operators can see and what
 * the browser is told, not between environments.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    // PostgREST and Supabase attach their own diagnostics to plain objects and
    // to Error subclasses alike; they are the most useful part of a database
    // failure and are lost by the three fields above.
    for (const key of ['code', 'details', 'hint', 'status', 'statusCode', 'cause']) {
      const value = (err as unknown as Record<string, unknown>)[key];
      if (value !== undefined) out[key] = value instanceof Error ? serializeError(value) : value;
    }
    return out;
  }
  if (err && typeof err === 'object') return redact(err) as Record<string, unknown>;
  return { message: String(err) };
}

// ── The sink ───────────────────────────────────────────────────────────────

export type LogSink = (record: LogRecord) => void;

/**
 * stdout, formatted.
 *
 * `console.error` for warn and above so that a host splitting streams puts
 * problems on stderr, which is where alerting usually looks.
 */
const consoleSink: LogSink = record => {
  if (AS_JSON) {
    const line = JSON.stringify(record);
    if (record.level === 'error' || record.level === 'warn') console.error(line);
    else console.log(line);
    return;
  }

  const { level, time, message, requestId, ...rest } = record;
  delete (rest as LogFields).environment;
  const head = `${time.slice(11, 23)} ${level.toUpperCase().padEnd(5)}${requestId ? ` [${requestId.slice(0, 8)}]` : ''} ${message}`;
  const detail = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
  if (level === 'error' || level === 'warn') console.error(head + detail);
  else console.log(head + detail);
};

let sink: LogSink = consoleSink;

/**
 * Send records somewhere else as well as, or instead of, stdout.
 *
 * The single integration point for Sentry, Datadog, OpenTelemetry or anything
 * that comes after them. Records arrive already redacted and already
 * structured, so a provider is an adapter rather than a change to the
 * application.
 *
 * A sink that throws is ignored: observability failing must never be the reason
 * a request fails. That is the same rule the rate limiter follows, for the same
 * reason.
 */
export function setLogSink(next: LogSink): void {
  sink = record => {
    try {
      next(record);
    } catch {
      try { consoleSink(record); } catch { /* nothing further to try */ }
    }
  };
}

/** Restore stdout-only logging. For tests, and for backing a provider out. */
export function resetLogSink(): void {
  sink = consoleSink;
}

// ── Writing ────────────────────────────────────────────────────────────────

function write(level: LogLevel, message: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < THRESHOLD) return;

  const record: LogRecord = {
    level,
    time: new Date().toISOString(),
    message,
    environment: ENVIRONMENT,
    ...(redact(fields ?? {}) as LogFields),
  };

  sink(record);
}

/**
 * The logger.
 *
 *     log.error('invoice creation failed', { requestId, route, err });
 *
 * `err` is conventional for an exception and is serialised properly by the
 * redactor. Everything else is free-form, and everything is redacted before it
 * is written.
 */
export const log = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};

/** What the health endpoint reports about logging, for operators. */
export const LOG_CONFIG = {
  environment: ENVIRONMENT,
  level: (Object.keys(LEVEL_ORDER) as LogLevel[]).find(l => LEVEL_ORDER[l] === THRESHOLD) ?? 'info',
  format: AS_JSON ? 'json' : 'pretty',
} as const;

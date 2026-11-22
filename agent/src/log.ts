/**
 * Structured logs on stderr, never containing a secret.
 *
 * Every value registered with addSecret() (API keys, tokens, the people salt, proxy credentials) is
 * replaced by "[redacted]" wherever it appears in a message or a field, and fields whose name looks
 * like a credential (token, key, secret, password, authorization, salt, cookie) are always redacted.
 * Format: one JSON object per line (default when stderr is not a terminal) or readable text.
 */
export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_FIELD = /(token|api_?key|apikey|secret|password|passwd|authorization|salt|cookie|credential)/i;

const secrets = new Set<string>();
let minLevel: Level = 'info';
let format: 'json' | 'text' = process.stderr.isTTY ? 'text' : 'json';
let sink: (line: string) => void = (line) => process.stderr.write(line + '\n');

export function addSecret(value: string | null | undefined): void {
  if (value && value.length >= 4) secrets.add(value);
}
export function configureLog(opts: { verbose?: boolean; format?: 'json' | 'text'; sink?: (line: string) => void }): void {
  if (opts.verbose !== undefined) minLevel = opts.verbose ? 'debug' : 'info';
  if (opts.format) format = opts.format;
  if (opts.sink) sink = opts.sink;
}
export const isVerbose = () => minLevel === 'debug';

/** A string with every registered secret replaced. */
export function redact(s: string): string {
  let out = s;
  for (const v of secrets) if (out.includes(v)) out = out.split(v).join('[redacted]');
  // Credentials embedded in URLs (https://user:pass@host) and Authorization-like fragments.
  out = out.replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1[redacted]@');
  out = out.replace(/\b(Bearer|Basic|GenieKey|Token token=)\s*[A-Za-z0-9._~+/=:-]{6,}/g, '$1 [redacted]');
  return out;
}

export function redactValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return redact(v);
  if (v === null || typeof v !== 'object' || depth > 6) return v;
  if (v instanceof Error) return redact(v.message);
  if (Array.isArray(v)) return v.map((x) => redactValue(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_FIELD.test(k) && x ? '[redacted]' : redactValue(x, depth + 1);
  return out;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  const f = fields ? (redactValue(fields) as Record<string, unknown>) : undefined;
  if (format === 'json') {
    sink(JSON.stringify({ ts: new Date().toISOString(), level, msg: redact(msg), ...(f ?? {}) }));
  } else {
    const extra = f && Object.keys(f).length ? ' ' + Object.entries(f).map(([k, x]) => `${k}=${typeof x === 'string' ? x : JSON.stringify(x)}`).join(' ') : '';
    sink(`${level === 'info' ? '' : level.toUpperCase() + ': '}${redact(msg)}${extra}`);
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};

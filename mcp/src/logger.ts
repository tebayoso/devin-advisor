// Structured JSON logging for the Worker.
//
// Every entry is a single JSON line so Cloudflare's log stream (and any
// downstream collector) can parse it. Sensitive values are redacted before
// serialization so tokens/secrets never reach the logs.

export type LogLevel = "debug" | "info" | "warn" | "error";

// Average tool latency budget from the PRD non-functional requirements.
export const LATENCY_BUDGET_MS = 800;

// Keys whose values must never be logged in clear text.
const SENSITIVE_KEY_RE =
  /(token|secret|password|passwd|api[-_]?key|authorization|auth|cookie|bearer|credential|session[-_]?token)/i;

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

/**
 * Recursively copy a value, replacing the values of sensitive-looking keys
 * with a redaction marker. Returns a structurally-cloned, log-safe value.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface LogFields {
  [key: string]: unknown;
}

/** Emit a single structured JSON log line at the given level. */
export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(redact(fields) as Record<string, unknown>),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

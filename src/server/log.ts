/**
 * Structured JSON logs (one line per event) in production, readable lines in development.
 * Never pass transcripts, audio URLs or API keys in `fields`.
 */
type Fields = Record<string, unknown> & { err?: unknown };

function emit(level: "info" | "warn" | "error", msg: string, fields: Fields = {}) {
  const { err, ...rest } = fields;
  const error = err instanceof Error ? { error: err.message, stack: err.stack?.split("\n").slice(0, 4).join(" | ") } : err !== undefined ? { error: String(err) } : {};
  if (process.env.NODE_ENV === "production" || process.env.LOG_FORMAT === "json") {
    console[level === "info" ? "log" : level](JSON.stringify({ t: new Date().toISOString(), level, msg, ...rest, ...error }));
  } else if (process.env.LOG_LEVEL !== "silent") {
    const kv = Object.entries({ ...rest, ...("error" in error ? { error: error.error } : {}) }).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
    console[level === "info" ? "log" : level](`[${level}] ${msg}${kv ? ` ${kv}` : ""}`);
  }
}

export const log = {
  info: (msg: string, f?: Fields) => emit("info", msg, f),
  warn: (msg: string, f?: Fields) => emit("warn", msg, f),
  error: (msg: string, f?: Fields) => emit("error", msg, f),
};

/**
 * Strip credentials before anything is written to logs, telemetry, or error
 * text. Setup links, invite/reset links, and guest support links all carry a
 * raw bearer token in the path; a long hex string is the same class of secret.
 */

const SECRET_PATH =
  /\/(?:onboard|invite)\/[^/?#\s]+|\/support\/t\/[^/?#\s]+/gi;

/** 24-byte setup/invite/guest tokens and longer hashes. */
const HEX_TOKEN = /\b[a-f0-9]{32,}\b/gi;

const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

const ASSIGNED_SECRET =
  /\b(api[_-]?key|client[_-]?secret|secret|password|token|authorization)\b(\s*[:=]\s*)(\S+)/gi;

export function redactSecrets(input: string): string {
  return input
    .replace(BEARER, "Bearer [redacted]")
    .replace(SECRET_PATH, (match) => {
      const slash = match.lastIndexOf("/");
      return `${match.slice(0, slash + 1)}[redacted]`;
    })
    .replace(ASSIGNED_SECRET, "$1$2[redacted]")
    .replace(HEX_TOKEN, "[redacted]");
}

/** Message only — never the raw error object, which can embed a query or URL. */
export function redactError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactSecrets(raw);
}

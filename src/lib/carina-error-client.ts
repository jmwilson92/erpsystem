"use client";

/**
 * Per-session error ring buffer and helpers to open Carina with a preloaded error.
 * Safe to import from client components. Persistence to the tenant table goes
 * through POST /api/carina/errors.
 */
import {
  ERROR_BUFFER_KEY,
  ERROR_BUFFER_LIMIT,
  latestFromBuffer,
  newCorrelationId,
  pushErrorBuffer,
  type CapturedError,
} from "@/lib/services/carina-errors-model";

export { newCorrelationId, latestFromBuffer, pushErrorBuffer, ERROR_BUFFER_KEY, ERROR_BUFFER_LIMIT };
export type { CapturedError };

export const ASK_CARINA_EVENT = "forge:carina-ask-error";

export function readErrorBuffer(): CapturedError[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(ERROR_BUFFER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CapturedError[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeErrorBuffer(rows: CapturedError[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ERROR_BUFFER_KEY, JSON.stringify(rows.slice(0, ERROR_BUFFER_LIMIT)));
  } catch {
    // quota / private mode
  }
}

export function recordLocalError(event: CapturedError): CapturedError {
  const row: CapturedError = {
    ...event,
    correlationId: event.correlationId || newCorrelationId(),
    createdAt: event.createdAt || new Date(),
  };
  writeErrorBuffer(pushErrorBuffer(readErrorBuffer(), row));
  return row;
}

export function latestLocalError(): CapturedError | null {
  return latestFromBuffer(readErrorBuffer());
}

export function askCarinaAboutError(event?: CapturedError | null) {
  const row = event || latestLocalError();
  if (typeof window === "undefined") return;
  const prompt = row
    ? `Why did that fail? (error ref ${row.correlationId})`
    : "What was that error?";
  window.dispatchEvent(new CustomEvent(ASK_CARINA_EVENT, { detail: { event: row, prompt } }));
}

export function askCarinaAboutErrorEvent(detail: { event?: CapturedError | null; prompt?: string }) {
  return new CustomEvent(ASK_CARINA_EVENT, { detail });
}

function shouldIgnoreUrl(url: string): boolean {
  return /\/api\/(e|telemetry|carina\/errors|tts|stt|health)(?:\?|$)/.test(url);
}

export function captureFromFailedResponse(params: {
  url: string;
  status: number;
  body?: Record<string, unknown> | null;
  method?: string;
  route?: string;
}): CapturedError {
  const body = params.body || {};
  const message = String(body.error || body.message || `Request failed (${params.status})`);
  const event = recordLocalError({
    correlationId: String(body.correlationId || newCorrelationId()),
    classification: "SYSTEM",
    errorCode: String(body.errorCode || `HTTP_${params.status}`),
    httpStatus: params.status,
    message,
    route: params.route || (typeof window !== "undefined" ? window.location.pathname : params.url),
    entityType: body.entityType ? String(body.entityType) : null,
    entityId: body.entityId ? String(body.entityId) : null,
    actionAttempted: params.method ? `${params.method} ${params.url}` : params.url,
    source: "client-api",
    payload: { url: params.url, status: params.status, error: message },
  });
  void persistRemote(event);
  return event;
}

export async function persistRemote(event: CapturedError): Promise<void> {
  try {
    await fetch("/api/carina/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correlationId: event.correlationId,
        errorCode: event.errorCode,
        message: event.message,
        httpStatus: event.httpStatus,
        route: event.route,
        entityType: event.entityType,
        entityId: event.entityId,
        actionAttempted: event.actionAttempted,
        source: event.source,
        payload: event.payload,
        sessionId: event.sessionId,
        prismaCode: event.payload && typeof event.payload === "object" ? (event.payload as { prismaCode?: string }).prismaCode : undefined,
        field: event.field,
      }),
      keepalive: true,
    });
  } catch {
    // offline / not signed in — keep the local buffer only
  }
}

export function installFetchCapture(): () => void {
  if (typeof window === "undefined" || (window as unknown as { __carinaFetchPatched?: boolean }).__carinaFetchPatched) {
    return () => undefined;
  }
  const orig = window.fetch.bind(window);
  (window as unknown as { __carinaFetchPatched?: boolean }).__carinaFetchPatched = true;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await orig(input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!res.ok && !shouldIgnoreUrl(url)) {
        let body: Record<string, unknown> | null = null;
        const clone = res.clone();
        try {
          const json = await clone.json();
          if (json && typeof json === "object") body = json as Record<string, unknown>;
        } catch {
          body = null;
        }
        captureFromFailedResponse({
          url,
          status: res.status,
          body,
          method: (init?.method || (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")) || "GET",
        });
      }
    } catch {
      // never break the caller
    }
    return res;
  };
  return () => {
    window.fetch = orig;
    (window as unknown as { __carinaFetchPatched?: boolean }).__carinaFetchPatched = false;
  };
}

export function reportClientError(params: {
  message: string;
  source: "window" | "boundary" | "action" | "client-api";
  route?: string;
  httpStatus?: number;
  errorCode?: string;
  entityType?: string;
  entityId?: string;
  actionAttempted?: string;
  payload?: Record<string, unknown>;
  correlationId?: string;
}): CapturedError {
  const event = recordLocalError({
    correlationId: params.correlationId || newCorrelationId(),
    classification: "SYSTEM",
    errorCode: params.errorCode || "SYS_UNKNOWN",
    httpStatus: params.httpStatus,
    message: params.message,
    route: params.route || (typeof window !== "undefined" ? window.location.pathname : undefined),
    entityType: params.entityType,
    entityId: params.entityId,
    actionAttempted: params.actionAttempted,
    source: params.source,
    payload: params.payload,
  });
  void persistRemote(event);
  return event;
}

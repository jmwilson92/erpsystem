import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-core";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { demoModeEnabled } from "@/lib/auth-core";

/**
 * Resolve identity for API routes.
 * Prefers real session; in demo mode allows persona; never anonymous.
 */
export async function requireApiUser() {
  // Prefer real session so forged cookies without DB session fail
  const sessionUser = await getSessionUser();
  if (sessionUser) return sessionUser;

  if (!demoModeEnabled()) {
    return null;
  }

  return getCurrentUser();
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export async function requireApiPermission(code: string) {
  const user = await requireApiUser();
  if (!user) return { user: null, error: unauthorized() as NextResponse };
  const ok = await userHasPermission(user.id, code);
  if (!ok) return { user: null, error: forbidden(`Missing ${code}`) as NextResponse };
  return { user, error: null as null };
}

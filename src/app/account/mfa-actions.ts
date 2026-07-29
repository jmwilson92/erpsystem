"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  confirmEnrolment,
  disableMfa,
  startEnrolment,
} from "@/lib/services/mfa";

export type MfaState =
  | null
  | { kind: "error"; message: string }
  | { kind: "enrolling"; secret: string; qrDataUrl: string }
  | { kind: "enabled"; recoveryCodes: string[] }
  | { kind: "disabled" };

/**
 * Begin enrolment and render the QR here rather than in the browser — the
 * secret is only ever needed server-side to draw it, so it never has to exist
 * in client JavaScript.
 */
export async function actionStartMfa(): Promise<MfaState> {
  const user = await getCurrentUser();
  if (!user) return { kind: "error", message: "Not signed in" };

  const company = await prisma.companySettings
    .findUnique({ where: { id: "default" } })
    .catch(() => null);

  try {
    const enrol = await startEnrolment({
      userId: user.id,
      account: user.email,
      issuer: company?.name || "Protessera",
    });
    if (enrol.alreadyEnabled) {
      return { kind: "error", message: "Two-factor is already on for this account" };
    }
    const qrDataUrl = await QRCode.toDataURL(enrol.uri, {
      margin: 1,
      width: 220,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    return { kind: "enrolling", secret: enrol.secret, qrDataUrl };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "Could not start enrolment",
    };
  }
}

export async function actionConfirmMfa(
  _prev: MfaState,
  formData: FormData
): Promise<MfaState> {
  const user = await getCurrentUser();
  if (!user) return { kind: "error", message: "Not signed in" };

  const result = await confirmEnrolment({
    userId: user.id,
    code: String(formData.get("code") || "").trim(),
  });
  if (!result.ok) {
    return { kind: "error", message: result.error || "That code isn't right" };
  }
  revalidatePath("/account");
  return { kind: "enabled", recoveryCodes: result.recoveryCodes ?? [] };
}

export async function actionDisableMfa(
  _prev: MfaState,
  formData: FormData
): Promise<MfaState> {
  const user = await getCurrentUser();
  if (!user) return { kind: "error", message: "Not signed in" };

  const result = await disableMfa({
    userId: user.id,
    code: String(formData.get("code") || "").trim(),
  });
  if (!result.ok) {
    return { kind: "error", message: result.error || "Could not turn it off" };
  }
  revalidatePath("/account");
  return { kind: "disabled" };
}

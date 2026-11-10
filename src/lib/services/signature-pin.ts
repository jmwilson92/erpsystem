import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

/** Shared by traveler, test-procedure, GFP and controlled-document sign-offs.
 * Identity comes from the authenticated caller; never accept a signer from a form.
 * PINs are compared in constant time and must never enter audit metadata.
 */
export async function verifySignaturePin(userId: string, pinCode?: string | null) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.isActive) throw new Error("Active signer account required");
  if (!user.pinCode?.trim()) throw new Error("Your account has no PIN configured — set one under My Account before signing");
  const digest = (s: string) => createHash("sha256").update(s).digest();
  if (!pinCode?.trim() || !timingSafeEqual(digest(pinCode.trim()), digest(user.pinCode.trim()))) {
    throw new Error(`Invalid PIN for ${user.name} — each person signs with their own PIN (set it under My Account)`);
  }
  return { id: user.id, name: user.name };
}

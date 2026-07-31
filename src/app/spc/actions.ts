"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { upsertCharacteristic } from "@/lib/services/spc";

/** SPC is quality analysis, so it rides the NCR-management permission. */
const MANAGE = "quality.ncr.manage";

function str(fd: FormData, key: string) {
  return ((fd.get(key) as string) || "").trim();
}

function num(fd: FormData, key: string): number | null {
  const raw = str(fd, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function actionUpsertCharacteristic(fd: FormData) {
  await requirePermission(MANAGE);
  try {
    await upsertCharacteristic({
      id: str(fd, "id") || undefined,
      partId: str(fd, "partId") || null,
      name: str(fd, "name"),
      unit: str(fd, "unit") || null,
      usl: num(fd, "usl"),
      lsl: num(fd, "lsl"),
      target: num(fd, "target"),
      subgroupSize: num(fd, "subgroupSize") ?? 1,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save";
    redirect(`/spc?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/spc");
  redirect("/spc?saved=1");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { classifyPart } from "@/lib/services/export-control";

/**
 * Classifying a part reuses `items.manage` rather than introducing an
 * `export.*` permission code. A new code would be absent from every existing
 * tenant's permission table until seeded, locking people out of a screen they
 * can already see in the nav.
 */
const MANAGE = "items.manage";

function str(fd: FormData, key: string) {
  return ((fd.get(key) as string) || "").trim();
}

/**
 * Validation failures here are ordinary user error — a mistyped ECCN — so
 * they come back as a message on the page rather than an error screen.
 */
export async function actionClassifyPart(fd: FormData) {
  const user = await requirePermission(MANAGE);
  const partId = str(fd, "partId");
  const returnTo = str(fd, "returnTo") || "/export-control";

  try {
    await classifyPart({
      partId,
      jurisdiction: str(fd, "jurisdiction"),
      usmlCategory: str(fd, "usmlCategory") || null,
      eccn: str(fd, "eccn") || null,
      countryOfOrigin: str(fd, "countryOfOrigin") || null,
      notes: str(fd, "exportNotes") || null,
      classifiedById: user.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Classification failed";
    redirect(`${returnTo}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/export-control");
  revalidatePath(`/items/${partId}`);
  redirect(`${returnTo}?classified=1`);
}

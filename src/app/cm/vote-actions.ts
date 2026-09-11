"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { actionVoteCm } from "@/app/actions";
import { flashToast } from "@/lib/flash";

function cmReturnTo(formData: FormData, fallback = "/cm?tab=submissions") {
  const raw = ((formData.get("returnTo") as string) || "").trim();
  if (raw.startsWith("/cm")) return raw;
  return fallback;
}

/** Assignment failures stay on the page as a toast, not the crash screen. */
export async function actionVoteCmFriendly(formData: FormData): Promise<void> {
  try {
    await actionVoteCm(formData);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    const message =
      err instanceof Error
        ? err.message
        : "That sign-off is assigned to someone else.";
    await flashToast(message, "error");
    redirect(cmReturnTo(formData));
  }
}

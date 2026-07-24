"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { flashToast } from "@/lib/flash";
import { isPlatformSupportEnabled } from "@/lib/platform";
import {
  addSupportNote,
  createGuestSupportTicket,
  createSupportTicket,
  postSupportMessage,
  updateSupportTicket,
} from "@/lib/services/support";

async function requirePlatform() {
  if (!(await isPlatformSupportEnabled())) {
    throw new Error("Support is only available on the ForgeRP platform");
  }
}

async function requirePlatformAdmin() {
  await requirePlatform();
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    throw new Error("Only platform staff can do that");
  }
  return user;
}

function revalidateSupport(ticketId?: string, guestToken?: string | null) {
  revalidatePath("/support");
  revalidatePath("/admin/support");
  if (ticketId) {
    revalidatePath(`/support/${ticketId}`);
    revalidatePath(`/admin/support/${ticketId}`);
  }
  if (guestToken) revalidatePath(`/support/t/${guestToken}`);
}

export async function actionCreateSupportTicket(formData: FormData) {
  await requirePlatform();
  const user = await getCurrentUser();
  if (!user) {
    // Guest path — name + email required
    let token: string;
    try {
      const ticket = await createGuestSupportTicket({
        name: String(formData.get("name") || ""),
        email: String(formData.get("email") || ""),
        subject: String(formData.get("subject") || ""),
        body: String(formData.get("body") || ""),
        priority: String(formData.get("priority") || "MEDIUM"),
        category: String(formData.get("category") || "GENERAL"),
        source: String(formData.get("source") || "LANDING"),
      });
      token = ticket.guestToken!;
      await flashToast(
        `Ticket ${ticket.number} opened. Bookmark your chat link to follow up.`
      );
    } catch (e) {
      await flashToast(
        e instanceof Error ? e.message : "Could not open ticket",
        "error"
      );
      redirect("/");
    }
    revalidateSupport(undefined, token);
    redirect(`/support/t/${token}`);
  }

  let ticketId: string;
  try {
    const ticket = await createSupportTicket({
      userId: user.id,
      subject: String(formData.get("subject") || ""),
      body: String(formData.get("body") || ""),
      priority: String(formData.get("priority") || "MEDIUM"),
      category: String(formData.get("category") || "GENERAL"),
      source: "APP",
    });
    ticketId = ticket.id;
    await flashToast(`Ticket ${ticket.number} opened — we'll reply here.`);
  } catch (e) {
    await flashToast(
      e instanceof Error ? e.message : "Could not open ticket",
      "error"
    );
    redirect("/support?new=1");
  }
  revalidateSupport(ticketId);
  redirect(`/support/${ticketId}`);
}

export async function actionPostSupportMessage(formData: FormData) {
  await requirePlatform();
  const user = await getCurrentUser();
  const ticketId = String(formData.get("ticketId") || "");
  const guestToken = String(formData.get("guestToken") || "") || null;
  const fromAdmin = formData.get("fromAdmin") === "1";
  try {
    await postSupportMessage({
      ticketId,
      userId: user?.id,
      userRole: user?.role,
      body: String(formData.get("body") || ""),
      guestToken,
    });
    await flashToast("Message sent");
  } catch (e) {
    await flashToast(
      e instanceof Error ? e.message : "Could not send message",
      "error"
    );
  }
  revalidateSupport(ticketId, guestToken);
  if (fromAdmin) redirect(`/admin/support/${ticketId}`);
  if (guestToken) redirect(`/support/t/${guestToken}`);
  redirect(`/support/${ticketId}`);
}

export async function actionAddSupportNote(formData: FormData) {
  const user = await requirePlatformAdmin();
  const ticketId = String(formData.get("ticketId") || "");
  try {
    await addSupportNote({
      ticketId,
      userId: user.id,
      userRole: user.role,
      body: String(formData.get("body") || ""),
    });
    await flashToast("Internal note saved");
  } catch (e) {
    await flashToast(
      e instanceof Error ? e.message : "Could not save note",
      "error"
    );
  }
  revalidateSupport(ticketId);
  redirect(`/admin/support/${ticketId}`);
}

export async function actionUpdateSupportTicket(formData: FormData) {
  const user = await requirePlatformAdmin();
  const ticketId = String(formData.get("ticketId") || "");
  const assigneeRaw = formData.get("assigneeId");
  try {
    await updateSupportTicket({
      ticketId,
      userId: user.id,
      userRole: user.role,
      status: String(formData.get("status") || "") || undefined,
      priority: String(formData.get("priority") || "") || undefined,
      category: String(formData.get("category") || "") || undefined,
      assigneeId:
        assigneeRaw === null || assigneeRaw === undefined
          ? undefined
          : String(assigneeRaw) || null,
    });
    await flashToast("Ticket updated");
  } catch (e) {
    await flashToast(
      e instanceof Error ? e.message : "Could not update ticket",
      "error"
    );
  }
  revalidateSupport(ticketId);
  redirect(`/admin/support/${ticketId}`);
}

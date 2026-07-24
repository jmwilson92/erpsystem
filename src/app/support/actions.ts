"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { flashToast } from "@/lib/flash";
import {
  addSupportNote,
  createSupportTicket,
  postSupportMessage,
  updateSupportTicket,
} from "@/lib/services/support";

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in required");
  return user;
}

function revalidateSupport(ticketId?: string) {
  revalidatePath("/support");
  revalidatePath("/admin/support");
  if (ticketId) {
    revalidatePath(`/support/${ticketId}`);
    revalidatePath(`/admin/support/${ticketId}`);
  }
}

export async function actionCreateSupportTicket(formData: FormData) {
  const user = await requireUser();
  let ticketId: string;
  try {
    const ticket = await createSupportTicket({
      userId: user.id,
      subject: String(formData.get("subject") || ""),
      body: String(formData.get("body") || ""),
      priority: String(formData.get("priority") || "MEDIUM"),
      category: String(formData.get("category") || "GENERAL"),
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
  const user = await requireUser();
  const ticketId = String(formData.get("ticketId") || "");
  const fromAdmin = formData.get("fromAdmin") === "1";
  try {
    await postSupportMessage({
      ticketId,
      userId: user.id,
      userRole: user.role,
      body: String(formData.get("body") || ""),
    });
    await flashToast("Message sent");
  } catch (e) {
    await flashToast(
      e instanceof Error ? e.message : "Could not send message",
      "error"
    );
  }
  revalidateSupport(ticketId);
  redirect(fromAdmin ? `/admin/support/${ticketId}` : `/support/${ticketId}`);
}

export async function actionAddSupportNote(formData: FormData) {
  const user = await requireUser();
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
  const user = await requireUser();
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

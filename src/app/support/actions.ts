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

async function requirePlatformAdmin() {
  if (!(await isPlatformSupportEnabled())) {
    throw new Error("Only ForgeRP platform staff can do that");
  }
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

export type CreateSupportTicketResult =
  | {
      ok: true;
      kind: "guest";
      number: string;
      token: string;
      href: string;
    }
  | {
      ok: true;
      kind: "user";
      number: string;
      id: string;
      href: string;
    }
  | { ok: false; error: string };

/**
 * Open a support ticket for anyone (landing, customer ERP, demo).
 * Tickets always land in the public platform desk for ForgeRP staff.
 *
 * - Dogfood (platform) signed-in users → ticket linked to their account
 * - Guests / customer tenants / demos → guest ticket (name + email + secret link)
 */
export async function actionCreateSupportTicketResult(
  formData: FormData
): Promise<CreateSupportTicketResult> {
  try {
    const platform = await isPlatformSupportEnabled();
    const user = await getCurrentUser();
    const source = String(formData.get("source") || "LANDING");

    // Platform dogfood account → linked ticket (same public schema as the user)
    if (platform && user) {
      const ticket = await createSupportTicket({
        userId: user.id,
        subject: String(formData.get("subject") || ""),
        body: String(formData.get("body") || ""),
        priority: String(formData.get("priority") || "MEDIUM"),
        category: String(formData.get("category") || "GENERAL"),
        source: source || "APP",
      });
      revalidateSupport(ticket.id);
      return {
        ok: true,
        kind: "user",
        number: ticket.number,
        id: ticket.id,
        href: `/support/${ticket.id}`,
      };
    }

    // Everyone else (landing guests, customer instances, demos)
    const ticket = await createGuestSupportTicket({
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || ""),
      subject: String(formData.get("subject") || ""),
      body: String(formData.get("body") || ""),
      priority: String(formData.get("priority") || "MEDIUM"),
      category: String(formData.get("category") || "GENERAL"),
      source: source || "LANDING",
    });
    const token = ticket.guestToken!;
    revalidateSupport(ticket.id, token);
    return {
      ok: true,
      kind: "guest",
      number: ticket.number,
      token,
      href: `/support/t/${token}`,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not open ticket",
    };
  }
}

/** Full-page form fallback (e.g. /support?new=1) — still redirects. */
export async function actionCreateSupportTicket(formData: FormData) {
  const result = await actionCreateSupportTicketResult(formData);
  if (!result.ok) {
    await flashToast(result.error, "error");
    const platform = await isPlatformSupportEnabled();
    const user = await getCurrentUser();
    redirect(platform && user ? "/support?new=1" : "/?chat=error");
  }
  await flashToast(`Ticket ${result.number} opened — we'll reply here.`);
  redirect(result.href);
}

export async function actionPostSupportMessage(formData: FormData) {
  const user = await getCurrentUser();
  const ticketId = String(formData.get("ticketId") || "");
  const guestToken = String(formData.get("guestToken") || "") || null;
  const fromAdmin = formData.get("fromAdmin") === "1";

  // Staff replies only from platform admin desk
  if (fromAdmin) {
    await requirePlatformAdmin();
  } else if (!guestToken) {
    // Account-linked replies only on platform dogfood
    if (!(await isPlatformSupportEnabled()) || !user) {
      await flashToast("Sign in on the platform to reply here.", "error");
      redirect("/");
    }
  }

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

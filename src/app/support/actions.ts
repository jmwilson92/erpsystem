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
  getSupportTicket,
  getSupportTicketByGuestToken,
  isTypingActive,
  markSupportThreadRead,
  postSupportMessage,
  setSupportTyping,
  updateSupportTicket,
} from "@/lib/services/support";
import { grokConfigured, grokTranslate } from "@/lib/services/grok";

/** Support staff portal only — not ERP company (tenant) admins. */
async function requireSupportStaff() {
  if (!(await isPlatformSupportEnabled())) {
    throw new Error("Only ForgeRP support staff can do that");
  }
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    throw new Error("Only ForgeRP support staff can do that");
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
      id: string;
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

export type SupportThreadMessage = {
  id: string;
  body: string;
  isStaff: boolean;
  createdAt: string;
  authorName: string;
  readAt: string | null;
};

export type SupportThreadResult =
  | {
      ok: true;
      id: string;
      number: string;
      subject: string;
      status: string;
      closed: boolean;
      guestToken: string | null;
      contactName: string;
      contactEmail: string;
      /** The other party is currently typing */
      peerTyping: boolean;
      messages: SupportThreadMessage[];
    }
  | { ok: false; error: string };

export type PostMessageResult =
  | { ok: true; messages: SupportThreadMessage[] }
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
      id: ticket.id,
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

function mapMessages(
  messages: {
    id: string;
    body: string;
    isStaff: boolean;
    createdAt: Date;
    readAt?: Date | null;
    author: { name: string } | null;
  }[],
  guestName?: string | null
): SupportThreadMessage[] {
  return messages.map((m) => ({
    id: m.id,
    body: m.body,
    isStaff: m.isStaff,
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt ? m.readAt.toISOString() : null,
    authorName: m.author?.name || (m.isStaff ? "ForgeRP" : guestName || "You"),
  }));
}

/** Load a ticket thread for the floating bubble (no page navigation). */
export async function actionFetchSupportThread(params: {
  ticketId?: string | null;
  guestToken?: string | null;
}): Promise<SupportThreadResult> {
  try {
    const token = params.guestToken?.trim() || null;
    const id = params.ticketId?.trim() || null;

    if (token) {
      const ticket = await getSupportTicketByGuestToken(token);
      if (!ticket) return { ok: false, error: "Conversation not found" };
      // Guest viewing → mark staff messages read
      await markSupportThreadRead({
        ticketId: ticket.id,
        who: "customer",
        guestToken: token,
      }).catch(() => undefined);
      return {
        ok: true,
        id: ticket.id,
        number: ticket.number,
        subject: ticket.subject,
        status: ticket.status,
        closed: ticket.status === "CLOSED",
        guestToken: ticket.guestToken,
        contactName: ticket.guestName || "You",
        contactEmail: ticket.guestEmail || "",
        peerTyping: isTypingActive(ticket.staffTypingAt),
        messages: mapMessages(ticket.messages, ticket.guestName),
      };
    }

    if (!id) return { ok: false, error: "Missing conversation id" };

    const user = await getCurrentUser();
    const platform = await isPlatformSupportEnabled();
    const ticket = await getSupportTicket(id);
    if (!ticket) return { ok: false, error: "Conversation not found" };

    const isStaff = platform && user?.role === "ADMIN";
    const isOwner = !!user && ticket.requesterId === user.id;
    if (!isStaff && !isOwner) {
      return { ok: false, error: "You don't have access to this conversation" };
    }

    await markSupportThreadRead({
      ticketId: ticket.id,
      who: isStaff ? "staff" : "customer",
      guestToken: ticket.guestToken,
    }).catch(() => undefined);

    // Re-fetch messages after read stamps
    const fresh = await getSupportTicket(id);

    return {
      ok: true,
      id: ticket.id,
      number: ticket.number,
      subject: ticket.subject,
      status: ticket.status,
      closed: ticket.status === "CLOSED",
      guestToken: ticket.guestToken,
      contactName:
        ticket.requester?.name || ticket.guestName || "Customer",
      contactEmail:
        ticket.requester?.email || ticket.guestEmail || "",
      peerTyping: isStaff
        ? isTypingActive(ticket.customerTypingAt)
        : isTypingActive(ticket.staffTypingAt),
      messages: mapMessages(
        (fresh || ticket).messages,
        ticket.guestName || ticket.requester?.name
      ),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not load conversation",
    };
  }
}

/** Reply in-bubble (no redirect). */
export async function actionPostSupportMessageResult(formData: FormData): Promise<PostMessageResult> {
  try {
    const user = await getCurrentUser();
    const ticketId = String(formData.get("ticketId") || "");
    const guestToken = String(formData.get("guestToken") || "") || null;
    const fromAdmin = formData.get("fromAdmin") === "1";

    if (fromAdmin) {
      await requireSupportStaff();
    } else if (!guestToken) {
      if (!(await isPlatformSupportEnabled()) || !user) {
        return { ok: false, error: "Sign in to reply here." };
      }
    }

    await postSupportMessage({
      ticketId,
      userId: user?.id,
      userRole: user?.role,
      body: String(formData.get("body") || ""),
      guestToken,
    });
    revalidateSupport(ticketId, guestToken);

    const thread = await actionFetchSupportThread({ ticketId, guestToken });
    if (!thread.ok) return { ok: false, error: thread.error };
    return { ok: true, messages: thread.messages };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not send message",
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

  // Staff replies only from support staff portal
  if (fromAdmin) {
    await requireSupportStaff();
  } else if (!guestToken) {
    if (!(await isPlatformSupportEnabled()) || !user) {
      await flashToast("Sign in to reply here.", "error");
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
  const user = await requireSupportStaff();
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
  const user = await requireSupportStaff();
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

/** Typing heartbeat for live “is typing…” indicators. */
export async function actionSupportTyping(params: {
  ticketId: string;
  who: "staff" | "customer";
  guestToken?: string | null;
}): Promise<{ ok: boolean }> {
  try {
    if (params.who === "staff") await requireSupportStaff();
    await setSupportTyping(params);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Real-time translation for chat messages (xAI). */
export async function actionTranslateText(params: {
  text: string;
  targetLanguage: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    if (!grokConfigured()) {
      return {
        ok: false,
        error: "Translation needs XAI_API_KEY configured on the server.",
      };
    }
    const text = params.text?.trim();
    if (!text) return { ok: false, error: "Nothing to translate" };
    const lang = params.targetLanguage?.trim() || "English";
    const out = await grokTranslate(text, lang);
    return { ok: true, text: out };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Translation failed",
    };
  }
}

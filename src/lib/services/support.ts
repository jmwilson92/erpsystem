/**
 * ForgeRP Support Staff helpdesk (separate from ERP company admins).
 *
 * - Support staff = accounts on the public/platform schema who run the
 *   unlisted /admin/support portal (today: role ADMIN on public only).
 * - ERP admins = ADMIN inside a customer tenant — they only manage their
 *   own business instance and cannot open the staff ticket queue.
 *
 * All tickets live in the public schema via controlPlaneClient.
 */
import { randomBytes } from "node:crypto";
import { controlPlaneClient } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getSiteUrl } from "@/lib/site";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  type SupportCategory,
  type SupportPriority,
  type SupportStatus,
} from "@/lib/support-constants";

export {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  type SupportCategory,
  type SupportPriority,
  type SupportStatus,
} from "@/lib/support-constants";

/** Always public schema — support desk is never tenant-scoped. */
const db = () => controlPlaneClient();

const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_USER"] as const;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function nextTicketNumber() {
  const count = await db().supportTicket.count();
  return `SUP-${String(count + 1).padStart(5, "0")}`;
}

/** Support staff portal gate (public-schema ADMIN). Not ERP tenant ADMIN. */
export function isSupportStaffRole(role: string) {
  return role === "ADMIN";
}

/** @deprecated use isSupportStaffRole */
function isStaffRole(role: string) {
  return isSupportStaffRole(role);
}

// ─── Email alerts to support staff ──────────────────────────────

/**
 * Who gets notified on new tickets / customer replies.
 * Prefer SUPPORT_NOTIFY_EMAILS (comma-separated); else all active public ADMINs.
 */
export async function listSupportStaffNotifyEmails(): Promise<string[]> {
  const raw = process.env.SUPPORT_NOTIFY_EMAILS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((e) => EMAIL_RE.test(e));
  }
  const staff = await db().user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { email: true },
  });
  return staff
    .map((u) => u.email.trim().toLowerCase())
    .filter((e) => EMAIL_RE.test(e));
}

/**
 * Fire-and-forget staff alert via Resend. Never throws to callers.
 * Requires RESEND_API_KEY + EMAIL_FROM (or SUPPORT_EMAIL_FROM).
 */
export async function notifySupportStaff(params: {
  subject: string;
  text: string;
}): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn(
        "[support] RESEND_API_KEY not set — support staff not emailed"
      );
      return;
    }
    const recipients = await listSupportStaffNotifyEmails();
    if (recipients.length === 0) {
      console.warn("[support] No support staff emails to notify");
      return;
    }
    const from =
      process.env.SUPPORT_EMAIL_FROM ||
      process.env.EMAIL_FROM ||
      "ForgeRP Support <onboarding@resend.dev>";

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: params.subject,
        text: params.text,
      }),
    });
    if (!resp.ok) {
      console.error(
        "[support] Resend failed:",
        resp.status,
        (await resp.text()).slice(0, 300)
      );
    }
  } catch (e) {
    console.error("[support] notifySupportStaff error:", e);
  }
}

function staffDeskUrl(ticketId: string) {
  return `${getSiteUrl()}/admin/support/${ticketId}`;
}

async function alertNewTicket(ticket: {
  id: string;
  number: string;
  subject: string;
  priority: string;
  source: string;
  fromLabel: string;
  preview: string;
}) {
  await notifySupportStaff({
    subject: `[Support] New ticket ${ticket.number}: ${ticket.subject}`,
    text: [
      `New support ticket ${ticket.number}`,
      ``,
      `From: ${ticket.fromLabel}`,
      `Source: ${ticket.source}`,
      `Priority: ${ticket.priority}`,
      `Subject: ${ticket.subject}`,
      ``,
      ticket.preview,
      ``,
      `Open in Support Staff portal:`,
      staffDeskUrl(ticket.id),
    ].join("\n"),
  });
}

async function alertCustomerReply(ticket: {
  id: string;
  number: string;
  subject: string;
  fromLabel: string;
  preview: string;
}) {
  await notifySupportStaff({
    subject: `[Support] Reply on ${ticket.number}: ${ticket.subject}`,
    text: [
      `Customer reply on ticket ${ticket.number}`,
      ``,
      `From: ${ticket.fromLabel}`,
      `Subject: ${ticket.subject}`,
      ``,
      ticket.preview,
      ``,
      `Open in Support Staff portal:`,
      staffDeskUrl(ticket.id),
    ].join("\n"),
  });
}

function newGuestToken() {
  return randomBytes(24).toString("hex");
}

// ─── Create / list ──────────────────────────────────────────────

export async function createSupportTicket(params: {
  userId: string;
  subject: string;
  body: string;
  priority?: string;
  category?: string;
  source?: string;
}) {
  const subject = params.subject.trim();
  const body = params.body.trim();
  if (!subject) throw new Error("Subject is required");
  if (!body) throw new Error("Describe what you need help with");

  const priority = SUPPORT_PRIORITIES.includes(
    (params.priority || "") as SupportPriority
  )
    ? (params.priority as SupportPriority)
    : "MEDIUM";
  const category = SUPPORT_CATEGORIES.includes(
    (params.category || "") as SupportCategory
  )
    ? (params.category as SupportCategory)
    : "GENERAL";

  const number = await nextTicketNumber();
  const now = new Date();

  const ticket = await db().supportTicket.create({
    data: {
      number,
      subject,
      priority,
      category,
      source: params.source || "APP",
      requesterId: params.userId,
      status: "OPEN",
      awaitingStaff: true,
      lastMessageAt: now,
      messages: {
        create: {
          authorId: params.userId,
          body,
          isStaff: false,
        },
      },
    },
  });

  await logAudit({
    entityType: "SupportTicket",
    entityId: ticket.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number: ticket.number, subject: ticket.subject },
  });

  const requester = await db().user.findUnique({
    where: { id: params.userId },
    select: { name: true, email: true },
  });
  void alertNewTicket({
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    priority: ticket.priority,
    source: ticket.source,
    fromLabel: requester
      ? `${requester.name} <${requester.email}>`
      : params.userId,
    preview: body.slice(0, 500),
  });

  return ticket;
}

/** Public marketing / landing page chat — no account required. */
export async function createGuestSupportTicket(params: {
  name: string;
  email: string;
  subject: string;
  body: string;
  priority?: string;
  category?: string;
  source?: string;
}) {
  const name = params.name.trim();
  const email = params.email.trim().toLowerCase();
  const subject = params.subject.trim();
  const body = params.body.trim();
  if (!name) throw new Error("Name is required");
  if (!EMAIL_RE.test(email)) throw new Error("A valid email is required");
  if (!subject) throw new Error("Subject is required");
  if (!body) throw new Error("Describe what you need help with");

  const priority = SUPPORT_PRIORITIES.includes(
    (params.priority || "") as SupportPriority
  )
    ? (params.priority as SupportPriority)
    : "MEDIUM";
  const category = SUPPORT_CATEGORIES.includes(
    (params.category || "") as SupportCategory
  )
    ? (params.category as SupportCategory)
    : "GENERAL";

  const number = await nextTicketNumber();
  const guestToken = newGuestToken();
  const now = new Date();

  const ticket = await db().supportTicket.create({
    data: {
      number,
      subject,
      priority,
      category,
      source: params.source || "LANDING",
      guestName: name,
      guestEmail: email,
      guestToken,
      status: "OPEN",
      awaitingStaff: true,
      lastMessageAt: now,
      messages: {
        create: {
          body: `${body}\n\n— ${name} <${email}>`,
          isStaff: false,
        },
      },
    },
  });

  await logAudit({
    entityType: "SupportTicket",
    entityId: ticket.id,
    action: "CREATED",
    metadata: {
      number: ticket.number,
      guest: true,
      email,
      subject: ticket.subject,
    },
  });

  void alertNewTicket({
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    priority: ticket.priority,
    source: ticket.source,
    fromLabel: `${name} <${email}>`,
    preview: body.slice(0, 500),
  });

  return ticket;
}

export async function listMySupportTickets(userId: string) {
  return db().supportTicket.findMany({
    where: { requesterId: userId },
    orderBy: { lastMessageAt: "desc" },
    include: {
      assignee: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  });
}

/** Tickets opened as guest (customer/demo users whose accounts live in other schemas). */
export async function listSupportTicketsByGuestEmail(email: string) {
  const e = email.trim().toLowerCase();
  if (!e) return [];
  return db().supportTicket.findMany({
    where: { guestEmail: e },
    orderBy: { lastMessageAt: "desc" },
    include: {
      assignee: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  });
}

export async function listAllSupportTickets(filters?: {
  status?: string;
  awaitingStaff?: boolean;
}) {
  const where: {
    status?: string | { in: string[] };
    awaitingStaff?: boolean;
  } = {};
  if (filters?.status && filters.status !== "ALL") {
    if (filters.status === "OPEN_QUEUE") {
      where.status = { in: [...OPEN_STATUSES] };
    } else {
      where.status = filters.status;
    }
  }
  if (filters?.awaitingStaff) {
    where.awaitingStaff = true;
    where.status = where.status ?? { in: [...OPEN_STATUSES] };
  }

  return db().supportTicket.findMany({
    where,
    orderBy: [{ awaitingStaff: "desc" }, { lastMessageAt: "desc" }],
    include: {
      requester: { select: { id: true, name: true, email: true, role: true } },
      assignee: { select: { id: true, name: true } },
      _count: { select: { messages: true, notes: true } },
    },
  });
}

export async function countOpenSupportForStaff() {
  return db().supportTicket.count({
    where: {
      awaitingStaff: true,
      status: { in: [...OPEN_STATUSES] },
    },
  });
}

export async function countUnreadRepliesForUser(userId: string) {
  return db().supportTicket.count({
    where: {
      requesterId: userId,
      awaitingStaff: false,
      status: { in: [...OPEN_STATUSES] },
    },
  });
}

// ─── Detail ─────────────────────────────────────────────────────

export async function getSupportTicket(id: string) {
  return db().supportTicket.findUnique({
    where: { id },
    include: {
      requester: {
        select: { id: true, name: true, email: true, role: true, title: true },
      },
      assignee: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { id: true, name: true, role: true } },
        },
      },
      notes: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function getSupportTicketByGuestToken(token: string) {
  if (!token || token.length < 16) return null;
  return db().supportTicket.findUnique({
    where: { guestToken: token },
    include: {
      assignee: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { id: true, name: true, role: true } },
        },
      },
    },
  });
}

/** Requester may see own ticket; platform staff may see any. */
export function canAccessTicket(
  ticket: { requesterId: string | null },
  user: { id: string; role: string }
) {
  if (isStaffRole(user.role)) return true;
  return !!ticket.requesterId && ticket.requesterId === user.id;
}

// ─── Messages / notes ───────────────────────────────────────────

export async function postSupportMessage(params: {
  ticketId: string;
  userId?: string | null;
  userRole?: string | null;
  body: string;
  /** Guest thread reply via secret token */
  guestToken?: string | null;
}) {
  const body = params.body.trim();
  if (!body) throw new Error("Message cannot be empty");

  const ticket = await db().supportTicket.findUnique({
    where: { id: params.ticketId },
  });
  if (!ticket) throw new Error("Ticket not found");
  if (ticket.status === "CLOSED") {
    throw new Error("This ticket is closed — open a new one if you need help");
  }

  const staff = isStaffRole(params.userRole || "");
  const isGuest =
    !!params.guestToken &&
    !!ticket.guestToken &&
    params.guestToken === ticket.guestToken;

  if (!staff && !isGuest && ticket.requesterId !== params.userId) {
    throw new Error("You can only message your own tickets");
  }

  const now = new Date();
  const isStaff = staff;

  const nextStatus =
    isStaff && ticket.status === "OPEN"
      ? "IN_PROGRESS"
      : isStaff && ticket.status === "WAITING_ON_USER"
        ? "IN_PROGRESS"
        : !isStaff && ticket.status === "RESOLVED"
          ? "OPEN"
          : ticket.status;

  const displayBody =
    isGuest && ticket.guestName
      ? body
      : body;

  const [message] = await db().$transaction([
    db().supportMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: params.userId || null,
        body: displayBody,
        isStaff,
      },
    }),
    db().supportTicket.update({
      where: { id: ticket.id },
      data: {
        lastMessageAt: now,
        awaitingStaff: !isStaff,
        status: nextStatus,
        ...(isStaff && !ticket.assigneeId && params.userId
          ? { assigneeId: params.userId }
          : {}),
      },
    }),
  ]);

  await logAudit({
    entityType: "SupportTicket",
    entityId: ticket.id,
    action: "MESSAGE",
    userId: params.userId,
    metadata: { isStaff, number: ticket.number, guest: isGuest },
  });

  // Email support staff only when the customer/visitor replied
  if (!isStaff) {
    const fromLabel = isGuest
      ? `${ticket.guestName || "Guest"} <${ticket.guestEmail || "unknown"}>`
      : (await db().user.findUnique({
          where: { id: params.userId || "" },
          select: { name: true, email: true },
        }).then((u) => (u ? `${u.name} <${u.email}>` : "Customer"))) ||
        "Customer";
    void alertCustomerReply({
      id: ticket.id,
      number: ticket.number,
      subject: ticket.subject,
      fromLabel,
      preview: body.slice(0, 500),
    });
  }

  return message;
}

export async function addSupportNote(params: {
  ticketId: string;
  userId: string;
  userRole: string;
  body: string;
}) {
  if (!isStaffRole(params.userRole)) {
    throw new Error("Only staff can add internal notes");
  }
  const body = params.body.trim();
  if (!body) throw new Error("Note cannot be empty");

  const ticket = await db().supportTicket.findUnique({
    where: { id: params.ticketId },
  });
  if (!ticket) throw new Error("Ticket not found");

  const note = await db().supportNote.create({
    data: {
      ticketId: ticket.id,
      authorId: params.userId,
      body,
    },
  });

  await logAudit({
    entityType: "SupportTicket",
    entityId: ticket.id,
    action: "NOTE",
    userId: params.userId,
    metadata: { number: ticket.number },
  });

  return note;
}

export async function updateSupportTicket(params: {
  ticketId: string;
  userId: string;
  userRole: string;
  status?: string;
  priority?: string;
  category?: string;
  assigneeId?: string | null;
}) {
  if (!isStaffRole(params.userRole)) {
    throw new Error("Only staff can update tickets");
  }

  const ticket = await db().supportTicket.findUnique({
    where: { id: params.ticketId },
  });
  if (!ticket) throw new Error("Ticket not found");

  const data: {
    status?: string;
    priority?: string;
    category?: string;
    assigneeId?: string | null;
    resolvedAt?: Date | null;
    closedAt?: Date | null;
    awaitingStaff?: boolean;
  } = {};

  if (params.status) {
    if (!SUPPORT_STATUSES.includes(params.status as SupportStatus)) {
      throw new Error("Invalid status");
    }
    data.status = params.status;
    if (params.status === "RESOLVED") {
      data.resolvedAt = new Date();
      data.awaitingStaff = false;
    }
    if (params.status === "CLOSED") {
      data.closedAt = new Date();
      data.awaitingStaff = false;
      if (!ticket.resolvedAt) data.resolvedAt = new Date();
    }
    if (params.status === "OPEN" || params.status === "IN_PROGRESS") {
      data.closedAt = null;
    }
    if (params.status === "WAITING_ON_USER") {
      data.awaitingStaff = false;
    }
  }
  if (
    params.priority &&
    SUPPORT_PRIORITIES.includes(params.priority as SupportPriority)
  ) {
    data.priority = params.priority;
  }
  if (
    params.category &&
    SUPPORT_CATEGORIES.includes(params.category as SupportCategory)
  ) {
    data.category = params.category;
  }
  if (params.assigneeId !== undefined) {
    data.assigneeId = params.assigneeId || null;
  }

  const updated = await db().supportTicket.update({
    where: { id: ticket.id },
    data,
  });

  await logAudit({
    entityType: "SupportTicket",
    entityId: ticket.id,
    action: "UPDATED",
    userId: params.userId,
    changes: data,
    metadata: { number: ticket.number },
  });

  return updated;
}

/** Platform ADMIN users for assignee dropdown (public schema). */
export async function listPlatformAdmins() {
  return db().user.findMany({
    where: { role: "ADMIN", isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
}

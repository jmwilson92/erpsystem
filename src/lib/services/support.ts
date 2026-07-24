/**
 * Platform support helpdesk (ForgeRP dogfood / marketing only).
 *
 * All tickets live in the public schema via controlPlaneClient — never in
 * customer tenant or demo schemas. Call isPlatformSupportEnabled() before
 * any UI or mutation so customer/demo instances never touch this module.
 */
import { randomBytes } from "node:crypto";
import { controlPlaneClient } from "@/lib/db";
import { logAudit } from "@/lib/audit";
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

/** Always public schema — platform support is never tenant-scoped. */
const db = () => controlPlaneClient();

const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_USER"] as const;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function nextTicketNumber() {
  const count = await db().supportTicket.count();
  return `SUP-${String(count + 1).padStart(5, "0")}`;
}

function isStaffRole(role: string) {
  return role === "ADMIN";
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

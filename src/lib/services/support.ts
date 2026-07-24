/**
 * In-app support helpdesk: users open chat tickets, staff (ADMIN) answer
 * and leave private notes. Tickets live in the tenant schema like all
 * other app data.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const SUPPORT_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_ON_USER",
  "RESOLVED",
  "CLOSED",
] as const;

export const SUPPORT_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const SUPPORT_CATEGORIES = [
  "GENERAL",
  "BILLING",
  "BUG",
  "HOWTO",
  "ACCOUNT",
  "OTHER",
] as const;

export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_USER"] as const;

async function nextTicketNumber() {
  const count = await prisma.supportTicket.count();
  return `SUP-${String(count + 1).padStart(5, "0")}`;
}

function isStaffRole(role: string) {
  return role === "ADMIN";
}

// ─── Create / list ──────────────────────────────────────────────

export async function createSupportTicket(params: {
  userId: string;
  subject: string;
  body: string;
  priority?: string;
  category?: string;
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

  const ticket = await prisma.supportTicket.create({
    data: {
      number,
      subject,
      priority,
      category,
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

export async function listMySupportTickets(userId: string) {
  return prisma.supportTicket.findMany({
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

  return prisma.supportTicket.findMany({
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
  return prisma.supportTicket.count({
    where: {
      awaitingStaff: true,
      status: { in: [...OPEN_STATUSES] },
    },
  });
}

export async function countUnreadRepliesForUser(userId: string) {
  // Tickets where staff replied last and ticket is still open for the user
  return prisma.supportTicket.count({
    where: {
      requesterId: userId,
      awaitingStaff: false,
      status: { in: [...OPEN_STATUSES] },
    },
  });
}

// ─── Detail ─────────────────────────────────────────────────────

export async function getSupportTicket(id: string) {
  return prisma.supportTicket.findUnique({
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

/** Requester may see own ticket; staff may see any. */
export function canAccessTicket(
  ticket: { requesterId: string },
  user: { id: string; role: string }
) {
  return ticket.requesterId === user.id || isStaffRole(user.role);
}

// ─── Messages / notes ───────────────────────────────────────────

export async function postSupportMessage(params: {
  ticketId: string;
  userId: string;
  userRole: string;
  body: string;
}) {
  const body = params.body.trim();
  if (!body) throw new Error("Message cannot be empty");

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: params.ticketId },
  });
  if (!ticket) throw new Error("Ticket not found");
  if (ticket.status === "CLOSED") {
    throw new Error("This ticket is closed — open a new one if you need help");
  }

  const staff = isStaffRole(params.userRole);
  if (!staff && ticket.requesterId !== params.userId) {
    throw new Error("You can only message your own tickets");
  }

  const now = new Date();
  const isStaff = staff;

  // Staff reply → waiting on user; user reply → needs staff
  const nextStatus =
    isStaff && ticket.status === "OPEN"
      ? "IN_PROGRESS"
      : isStaff && ticket.status === "WAITING_ON_USER"
        ? "IN_PROGRESS"
        : !isStaff && ticket.status === "RESOLVED"
          ? "OPEN"
          : ticket.status;

  const [message] = await prisma.$transaction([
    prisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: params.userId,
        body,
        isStaff,
      },
    }),
    prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        lastMessageAt: now,
        awaitingStaff: !isStaff,
        status: nextStatus,
        ...(isStaff && !ticket.assigneeId
          ? { assigneeId: params.userId }
          : {}),
        resolvedAt: nextStatus === "RESOLVED" ? ticket.resolvedAt : null,
      },
    }),
  ]);

  await logAudit({
    entityType: "SupportTicket",
    entityId: ticket.id,
    action: "MESSAGE",
    userId: params.userId,
    metadata: { isStaff, number: ticket.number },
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

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: params.ticketId },
  });
  if (!ticket) throw new Error("Ticket not found");

  const note = await prisma.supportNote.create({
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

  const ticket = await prisma.supportTicket.findUnique({
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

  const updated = await prisma.supportTicket.update({
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

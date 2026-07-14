/**
 * Performance review cycles — company policy, self-assessment push,
 * manager discussion notes, and dual sign-off.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { canDecideFor, getHrPersona } from "@/lib/services/hr";

export type SelfRating = {
  question: string;
  rating: number;
  comment?: string;
};

export async function getReviewPolicy() {
  return prisma.reviewPolicy.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      frequencyMonths: 12,
      selfReviewLeadDays: 30,
      questions: JSON.stringify([
        "How well did you meet your goals this period?",
        "What accomplishment are you most proud of?",
        "Where do you need more support or training?",
        "How would you rate your collaboration with the team?",
        "What should your goals be for the next period?",
      ]),
    },
    update: {},
  });
}

export function parseReviewQuestions(policy: {
  questions: string | null;
}): string[] {
  if (!policy.questions) return [];
  try {
    const parsed = JSON.parse(policy.questions);
    return Array.isArray(parsed)
      ? parsed.map((q) => String(q).trim()).filter(Boolean)
      : [];
  } catch {
    return policy.questions
      .split("\n")
      .map((q) => q.trim())
      .filter(Boolean);
  }
}

export async function saveReviewPolicy(params: {
  frequencyMonths: number;
  selfReviewLeadDays: number;
  questions: string[];
  updatedById?: string | null;
}) {
  const frequencyMonths = Math.max(1, Math.min(36, params.frequencyMonths || 12));
  const selfReviewLeadDays = Math.max(
    1,
    Math.min(90, params.selfReviewLeadDays || 30)
  );
  const questions = params.questions.map((q) => q.trim()).filter(Boolean);
  const policy = await prisma.reviewPolicy.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      frequencyMonths,
      selfReviewLeadDays,
      questions: JSON.stringify(questions),
      updatedById: params.updatedById || null,
    },
    update: {
      frequencyMonths,
      selfReviewLeadDays,
      questions: JSON.stringify(questions),
      updatedById: params.updatedById || null,
    },
  });
  await logAudit({
    entityType: "ReviewPolicy",
    entityId: policy.id,
    action: "REVIEW_POLICY_SAVED",
    userId: params.updatedById,
    changes: { frequencyMonths, selfReviewLeadDays, questionCount: questions.length },
  });
  return policy;
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

function periodLabel(due: Date): string {
  const y = due.getFullYear();
  const q = Math.floor(due.getMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

/**
 * Open self-review forms for employees whose next review is within the
 * lead window. Safe to call on HR page load (idempotent).
 */
export async function openDueReviewCycles(opts?: { actorId?: string | null }) {
  const policy = await getReviewPolicy();
  const questions = parseReviewQuestions(policy);
  if (questions.length === 0) return { opened: 0 };

  const now = new Date();
  const leadMs = policy.selfReviewLeadDays * 86_400_000;

  const employees = await prisma.user.findMany({
    where: { isActive: true, managerId: { not: null } },
    select: {
      id: true,
      name: true,
      managerId: true,
      createdAt: true,
      performanceReviews: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  let opened = 0;
  for (const emp of employees) {
    const open = emp.performanceReviews.find((r) => r.status !== "COMPLETED");
    if (open) continue;

    const lastDone = emp.performanceReviews.find(
      (r) => r.status === "COMPLETED" && r.completedAt
    );
    const anchor = lastDone?.completedAt || emp.createdAt;
    const nextDue = addMonths(anchor, policy.frequencyMonths);
    // Push when within lead days of due (or already overdue).
    if (nextDue.getTime() - now.getTime() > leadMs) continue;

    await prisma.performanceReview.create({
      data: {
        employeeId: emp.id,
        reviewerId: emp.managerId!,
        period: periodLabel(nextDue),
        status: "SELF_REVIEW",
        dueDate: nextDue,
        questions: JSON.stringify(questions),
      },
    });
    await logAudit({
      entityType: "PerformanceReview",
      entityId: emp.id,
      action: "REVIEW_CYCLE_OPENED",
      userId: opts?.actorId,
      metadata: { employeeId: emp.id, dueDate: nextDue.toISOString() },
    });
    opened += 1;
  }
  return { opened };
}

export async function submitSelfReview(params: {
  reviewId: string;
  employeeId: string;
  ratings: SelfRating[];
}) {
  const review = await prisma.performanceReview.findUniqueOrThrow({
    where: { id: params.reviewId },
  });
  if (review.employeeId !== params.employeeId) {
    throw new Error("Only the employee may submit a self-review");
  }
  if (!["SELF_REVIEW", "DRAFT"].includes(review.status)) {
    throw new Error(`Self-review not open (status ${review.status})`);
  }
  const cleaned = params.ratings
    .map((r) => ({
      question: String(r.question || "").trim(),
      rating: Math.min(5, Math.max(1, Number(r.rating) || 3)),
      comment: (r.comment || "").trim() || undefined,
    }))
    .filter((r) => r.question);
  if (cleaned.length === 0) throw new Error("At least one self-rating required");

  const updated = await prisma.performanceReview.update({
    where: { id: review.id },
    data: {
      selfRatings: JSON.stringify(cleaned),
      selfSubmittedAt: new Date(),
      status: "IN_PROGRESS",
    },
  });
  await logAudit({
    entityType: "PerformanceReview",
    entityId: review.id,
    action: "SELF_REVIEW_SUBMITTED",
    userId: params.employeeId,
  });
  return updated;
}

export async function saveManagerReviewNotes(params: {
  reviewId: string;
  manager: { id: string; role: string };
  overallRating?: number | null;
  ratingRationale?: string | null;
  strengths?: string | null;
  improvements?: string | null;
  careerNotes?: string | null;
  readyForSignoff?: boolean;
}) {
  const review = await prisma.performanceReview.findUniqueOrThrow({
    where: { id: params.reviewId },
  });
  const ok = await canDecideFor(
    params.manager,
    review.employeeId,
    "hr.review.manage"
  );
  if (!ok) throw new Error("Not authorized to write this review");
  if (review.status === "COMPLETED") {
    throw new Error("Review already completed");
  }

  // The rating must carry a written justification. Check against the
  // effective rating (incoming value if provided, else what's on record)
  // and the effective rationale.
  const effectiveRating =
    params.overallRating === undefined
      ? review.overallRating
      : params.overallRating;
  const effectiveRationale =
    params.ratingRationale === undefined
      ? review.ratingRationale
      : params.ratingRationale?.trim() || null;
  if (effectiveRating != null && !effectiveRationale) {
    throw new Error("Explain the rating — a written rationale is required.");
  }

  const nextStatus =
    params.readyForSignoff || review.status === "AWAITING_SIGNOFF"
      ? "AWAITING_SIGNOFF"
      : review.status === "SELF_REVIEW"
        ? "IN_PROGRESS"
        : review.status === "DRAFT"
          ? "IN_PROGRESS"
          : review.status;

  const updated = await prisma.performanceReview.update({
    where: { id: review.id },
    data: {
      overallRating:
        params.overallRating === undefined
          ? review.overallRating
          : params.overallRating,
      ratingRationale:
        params.ratingRationale === undefined
          ? review.ratingRationale
          : params.ratingRationale?.trim() || null,
      strengths:
        params.strengths === undefined
          ? review.strengths
          : params.strengths?.trim() || null,
      improvements:
        params.improvements === undefined
          ? review.improvements
          : params.improvements?.trim() || null,
      careerNotes:
        params.careerNotes === undefined
          ? review.careerNotes
          : params.careerNotes?.trim() || null,
      reviewerId: params.manager.id,
      status: nextStatus,
    },
  });
  await logAudit({
    entityType: "PerformanceReview",
    entityId: review.id,
    action: "MANAGER_REVIEW_SAVED",
    userId: params.manager.id,
    changes: { status: nextStatus },
  });
  return updated;
}

export async function signOffReview(params: {
  reviewId: string;
  user: { id: string; role: string };
  role: "EMPLOYEE" | "MANAGER";
}) {
  const review = await prisma.performanceReview.findUniqueOrThrow({
    where: { id: params.reviewId },
  });
  if (review.status === "COMPLETED") return review;

  if (params.role === "EMPLOYEE") {
    if (review.employeeId !== params.user.id) {
      throw new Error("Only the employee may sign as employee");
    }
  } else {
    const ok =
      review.reviewerId === params.user.id ||
      (await canDecideFor(
        params.user,
        review.employeeId,
        "hr.review.manage"
      ));
    if (!ok) throw new Error("Not authorized to sign as manager");
  }

  // Allow sign-off once discussion notes exist or both parties are ready.
  if (
    !["IN_PROGRESS", "AWAITING_SIGNOFF", "SELF_REVIEW"].includes(review.status) &&
    !review.selfSubmittedAt
  ) {
    throw new Error("Review is not ready for sign-off");
  }

  const employeeSignedAt =
    params.role === "EMPLOYEE" ? new Date() : review.employeeSignedAt;
  const managerSignedAt =
    params.role === "MANAGER" ? new Date() : review.managerSignedAt;
  const both = Boolean(employeeSignedAt && managerSignedAt);

  const updated = await prisma.performanceReview.update({
    where: { id: review.id },
    data: {
      employeeSignedAt,
      managerSignedAt,
      status: both ? "COMPLETED" : "AWAITING_SIGNOFF",
      completedAt: both ? new Date() : null,
    },
  });
  await logAudit({
    entityType: "PerformanceReview",
    entityId: review.id,
    action: both ? "REVIEW_COMPLETED" : `REVIEW_SIGNED_${params.role}`,
    userId: params.user.id,
  });
  return updated;
}

/** May the viewer open this person's HR page? */
export async function canViewPerson(
  viewer: { id: string; role: string },
  personId: string
): Promise<boolean> {
  if (viewer.id === personId) return true;
  const persona = await getHrPersona(viewer);
  if (persona.isHrAdmin) return true;
  if (persona.reportIds.includes(personId)) return true;
  return false;
}

export async function getPersonPage(personId: string) {
  const [profile, timesheets, openReviews, allFeedback] = await Promise.all([
    (async () => {
      const { getEmployeeProfile } = await import("@/lib/services/hr");
      return getEmployeeProfile(personId);
    })(),
    prisma.timesheet.findMany({
      where: { userId: personId },
      orderBy: { periodStart: "desc" },
      take: 12,
      include: { entries: true },
    }),
    prisma.performanceReview.findMany({
      where: {
        employeeId: personId,
        status: { not: "COMPLETED" },
      },
      include: {
        reviewer: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // Managers/HR see everything, including MANAGER_ONLY notes
    prisma.feedbackNote.findMany({
      where: { aboutUserId: personId },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true, title: true } } },
    }),
  ]);
  return { ...profile, timesheets, openReviews, feedback: allFeedback };
}

export function parseSelfRatings(
  raw: string | null | undefined
): SelfRating[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r) => ({
      question: String(r.question || ""),
      rating: Number(r.rating) || 0,
      comment: r.comment ? String(r.comment) : undefined,
    }));
  } catch {
    return [];
  }
}

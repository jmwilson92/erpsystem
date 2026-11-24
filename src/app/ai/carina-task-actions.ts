"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import {
  addCarinaTask,
  cancelCarinaTask,
  decideCarinaAction,
  prismaCarinaTaskDeps,
  reorderCarinaTasks,
  updateCarinaTaskText,
  type CarinaTaskRecord,
} from "@/lib/services/carina-tasks";

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in required");
  return user;
}

export async function actionListCarinaTasks(): Promise<CarinaTaskRecord[]> {
  const user = await requireUser();
  const deps = await prismaCarinaTaskDeps();
  const tasks = await deps.tasks.listForUser(user.id);
  const { listPendingProductionJournalsForUser, productionJournalAsCarinaTask } = await import(
    "@/lib/services/production-journals"
  );
  const journals = await listPendingProductionJournalsForUser({
    userId: user.id,
    userRole: user.role,
  });
  const extras = journals.map((journal) =>
    productionJournalAsCarinaTask({ journal, userId: user.id })
  );
  return [...extras, ...tasks];
}

export async function actionAddCarinaTask(formData: FormData) {
  const user = await requireUser();
  const text = String(formData.get("text") || "").trim();
  if (!text) throw new Error("Tell me what to add.");
  const confirmed = String(formData.get("confirmedReadback") || "") === "on";
  const deps = await prismaCarinaTaskDeps();
  const out = await addCarinaTask(deps, { userId: user.id, text, confirmedReadback: confirmed });
  revalidatePath("/ai");
  revalidatePath("/approvals");
  revalidatePath("/notifications");
  return { text: out.text, href: out.href, task: out.task };
}

export async function actionCancelCarinaTask(formData: FormData) {
  const user = await requireUser();
  const taskId = String(formData.get("taskId") || "");
  const note = String(formData.get("note") || "") || undefined;
  const deps = await prismaCarinaTaskDeps();
  await cancelCarinaTask(deps, { userId: user.id, taskId, note });
  revalidatePath("/ai");
  revalidatePath("/approvals");
}

export async function actionUpdateCarinaTask(formData: FormData) {
  const user = await requireUser();
  const taskId = String(formData.get("taskId") || "");
  const text = String(formData.get("text") || "").trim();
  const deps = await prismaCarinaTaskDeps();
  await updateCarinaTaskText(deps, { userId: user.id, taskId, text });
  revalidatePath("/ai");
  revalidatePath("/approvals");
}

export async function actionReorderCarinaTasks(taskIds: string[]) {
  const user = await requireUser();
  const deps = await prismaCarinaTaskDeps();
  return reorderCarinaTasks(deps, {
    userId: user.id,
    taskIds: taskIds.filter((id) => !id.startsWith("pj:")),
  });
}

export async function actionDecideCarinaAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = String(formData.get("taskId") || "") || undefined;
  const approvalId = String(formData.get("approvalId") || "") || undefined;
  const decision = String(formData.get("decision") || "") as "APPROVED" | "REJECTED";
  if (decision !== "APPROVED" && decision !== "REJECTED") throw new Error("Choose approve or reject.");
  const note = String(formData.get("note") || formData.get("decisionNotes") || "") || undefined;
  if (decision === "REJECTED" && !note) throw new Error("A reason is required to reject.");
  const deps = await prismaCarinaTaskDeps();
  await decideCarinaAction(deps, { userId: user.id, taskId, approvalId, decision, note });
  revalidatePath("/ai");
  revalidatePath("/approvals");
  revalidatePath("/notifications");
}

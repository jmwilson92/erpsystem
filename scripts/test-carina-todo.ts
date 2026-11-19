import assert from "node:assert/strict";
import {
  addCarinaTask,
  cancelCarinaTask,
  classifyCarinaTask,
  consumeAwaySummary,
  decideCarinaAction,
  formatAwaySummary,
  listCarinaApprovalsForUser,
  looksLikeAddToList,
  memoryCarinaTaskStore,
  reorderCarinaTasks,
  runDueTasks,
  stripAddToListPrefix,
  utteranceConfirmsReadback,
  type CarinaTaskDeps,
  type CarinaTaskRecord,
} from "../src/lib/services/carina-tasks";

assert.equal(looksLikeAddToList("Carina, add to your list: count open work orders"), true);
assert.equal(looksLikeAddToList("when you get a chance, draft a purchase request for 10 bolts"), true);
assert.equal(looksLikeAddToList("How do I add to a list?"), false);
assert.equal(stripAddToListPrefix("add to your list: count open work orders"), "count open work orders");
assert.equal(utteranceConfirmsReadback("add to your list: change project Alpha status, I confirm"), true);

assert.equal(classifyCarinaTask({ text: "count open work orders" }).safety, "unattended");
assert.equal(classifyCarinaTask({ text: "draft a purchase request for 10 bolts" }).safety, "unattended");
assert.equal(classifyCarinaTask({ text: "plan demand for 20 WIDGET-20" }).safety, "unattended");
assert.equal(classifyCarinaTask({ text: "change the status of project Alpha to active" }).safety, "needs-approval");
assert.equal(
  classifyCarinaTask({ text: "change the status of project Alpha to active", confirmedReadback: true }).safety,
  "unattended"
);
assert.equal(classifyCarinaTask({ text: "run payroll for last week" }).safety, "excluded");
assert.match(formatAwaySummary({ finished: 3, needsApproval: 1, needsInfo: 0, failed: 0 }), /While you were away I finished 3, 1 needs your OK/);

function depsFor(userNames: Record<string, string> = { u1: "Jeramey" }): { deps: CarinaTaskDeps; approvals: { id: string; status: string; comments?: string }[] } {
  const tasks = memoryCarinaTaskStore();
  const approvals: { id: string; status: string; comments?: string; entityId?: string }[] = [];
  let approvalSeq = 1;
  const ran: string[] = [];
  const deps: CarinaTaskDeps = {
    tasks,
    hasPermission: async (userId, perm) => userId === "mgr" && !!perm,
    loadUserName: async (id) => userNames[id] || id,
    createApproval: async (task) => {
      const id = `appr_${approvalSeq++}`;
      approvals.push({ id, status: "PENDING", entityId: task.id });
      return id;
    },
    decideApprovalRow: async ({ approvalId, status, comments }) => {
      const row = approvals.find((a) => a.id === approvalId);
      if (row) {
        row.status = status;
        row.comments = comments;
      }
    },
    notify: async () => undefined,
    audit: async () => undefined,
    executor: {
      async runAsUser({ text, userId }) {
        ran.push(`${userId}:${text}`);
        if (/need more/.test(text)) return { outcome: "needs-info", text: "What quantity?", question: "What quantity?" };
        if (/fail please/.test(text)) return { outcome: "failed", text: "Boom" };
        return { outcome: "done", text: `Ran as ${userId}: ${text}`, href: "/work-orders" };
      },
    },
  };
  (deps as unknown as { ran: string[] }).ran = ran;
  return { deps, approvals };
}

async function main() {
  // Unattended lookup: no approval item, just gets done
  {
    const { deps, approvals } = depsFor();
    const out = await addCarinaTask(deps, { userId: "u1", text: "Carina, add to your list: count open work orders" });
    assert.ok(out.task);
    assert.equal(out.task!.status, "done");
    assert.equal(approvals.length, 0);
    assert.match(out.task!.resultSummary || "", /Ran as u1/);
  }

  // Draft PR: unattended, no approval item
  {
    const { deps, approvals } = depsFor();
    const out = await addCarinaTask(deps, {
      userId: "u1",
      text: "when you get a chance, draft a purchase request for 10 bolts",
    });
    assert.ok(out.task);
    assert.equal(out.task!.status, "done");
    assert.equal(approvals.length, 0);
  }

  // Existing-record change without confirmation → needs-approval + inbox item
  {
    const { deps, approvals } = depsFor();
    const out = await addCarinaTask(deps, {
      userId: "u1",
      text: "add to your list: change the status of project Alpha to active",
    });
    assert.ok(out.task);
    assert.equal(out.task!.status, "needs-approval");
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].status, "PENDING");
    assert.match(out.text, /Approvals/);
    const inbox = await listCarinaApprovalsForUser(deps, { userId: "u1" });
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].createdByName, "Jeramey");
    assert.match(inbox[0].readbackText, /project Alpha/);
    // Manager with the relevant permission also sees it
    const asMgr = await listCarinaApprovalsForUser(deps, { userId: "mgr" });
    assert.equal(asMgr.length, 1);
    // Stranger does not
    const asOther = await listCarinaApprovalsForUser(deps, { userId: "other" });
    assert.equal(asOther.length, 0);
  }

  // Same change with read-back confirmation runs unattended, no approval item
  {
    const { deps, approvals } = depsFor();
    const out = await addCarinaTask(deps, {
      userId: "u1",
      text: "add to your list: change the status of project Alpha to active, I confirm",
    });
    assert.ok(out.task);
    assert.equal(out.task!.status, "done");
    assert.equal(out.task!.confirmedReadback, true);
    assert.equal(approvals.length, 0);
  }

  // Approve → runner executes as the requesting user and marks done
  {
    const { deps, approvals } = depsFor();
    const out = await addCarinaTask(deps, {
      userId: "u1",
      text: "add to your list: change the status of project Alpha to active",
    });
    const decided = await decideCarinaAction(deps, {
      userId: "mgr",
      taskId: out.task!.id,
      decision: "APPROVED",
    });
    assert.equal(decided.task.status, "done");
    assert.equal(decided.task.approvedById, "mgr");
    assert.match(decided.task.resultSummary || "", /Ran as u1/);
    assert.equal(approvals[0].status, "APPROVED");
    assert.notEqual(decided.task.approvedById, "u1"); // mgr approved, but executed as requester
  }

  // Reject → cancelled with note
  {
    const { deps, approvals } = depsFor();
    const out = await addCarinaTask(deps, {
      userId: "u1",
      text: "add to your list: change the status of project Alpha to active",
    });
    const decided = await decideCarinaAction(deps, {
      userId: "u1",
      taskId: out.task!.id,
      decision: "REJECTED",
      note: "Not yet, wait until Friday",
    });
    assert.equal(decided.task.status, "cancelled");
    assert.match(decided.task.rejectedNote || "", /Friday/);
    assert.equal(approvals[0].status, "REJECTED");
    assert.match(approvals[0].comments || "", /Friday/);
  }

  // Excluded is not added
  {
    const { deps, approvals } = depsFor();
    const out = await addCarinaTask(deps, { userId: "u1", text: "add to your list: run payroll for last week" });
    assert.equal(out.task, null);
    assert.equal(approvals.length, 0);
    assert.match(out.text, /payroll|money movement|HR/i);
  }

  // needs-info
  {
    const { deps } = depsFor();
    const out = await addCarinaTask(deps, { userId: "u1", text: "add to your list: need more on this order" });
    assert.equal(out.task!.status, "needs-info");
    assert.match(out.task!.needsInfoQuestion || "", /quantity/i);
  }

  // cancel, reorder, away summary
  {
    const { deps } = depsFor();
    deps.executor = undefined;
    const a = await addCarinaTask(deps, { userId: "u1", text: "add to your list: count open work orders" });
    const b = await addCarinaTask(deps, {
      userId: "u1",
      text: "add to your list: change the status of project Alpha to active",
    });
    assert.equal(a.task!.status, "queued");
    assert.equal(b.task!.status, "needs-approval");
    const cancelled = await cancelCarinaTask(deps, { userId: "u1", taskId: b.task!.id, note: "Changed my mind" });
    assert.equal(cancelled.status, "cancelled");
    const c = await addCarinaTask(deps, { userId: "u1", text: "add to your list: draft a purchase request for caps" });
    const d = await addCarinaTask(deps, { userId: "u1", text: "add to your list: how many open NCR cases" });
    await reorderCarinaTasks(deps, { userId: "u1", taskIds: [d.task!.id, c.task!.id] });
    const list = await deps.tasks.listForUser("u1");
    const ids = list.map((t: CarinaTaskRecord) => t.id);
    assert.ok(ids.indexOf(d.task!.id) < ids.indexOf(c.task!.id));
    deps.executor = {
      async runAsUser({ userId, text }) {
        return { outcome: "done", text: `later ${userId} ${text}` };
      },
    };
    await runDueTasks(deps);
    const summary = await consumeAwaySummary(deps, "u1");
    assert.ok(summary.finished >= 3);
    assert.match(summary.text, /While you were away I finished/);
    const again = await consumeAwaySummary(deps, "u1");
    assert.equal(again.finished, 0);
    assert.equal(again.text, "");
  }

  // runDueTasks claims queued work
  {
    const { deps } = depsFor();
    deps.executor = undefined;
    const out = await addCarinaTask(deps, { userId: "u1", text: "add to your list: count open work orders" });
    assert.equal(out.task!.status, "queued");
    deps.executor = {
      async runAsUser({ userId, text }) {
        return { outcome: "done", text: `later ${userId} ${text}` };
      },
    };
    const ran = await runDueTasks(deps);
    assert.equal(ran, 1);
    const again = await deps.tasks.get(out.task!.id);
    assert.equal(again!.status, "done");
  }

  // Source contracts
  const fs = await import("node:fs");
  const cron = fs.readFileSync("src/app/api/cron/carina-tasks/route.ts", "utf8");
  assert.match(cron, /runWithSchema/);
  assert.match(cron, /CRON_SECRET/);
  const approvals = fs.readFileSync("src/app/approvals/page.tsx", "utf8");
  assert.match(approvals, /Carina action/);
  const vercel = fs.readFileSync("vercel.json", "utf8");
  assert.match(vercel, /\/api\/cron\/carina-tasks/);
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /model CarinaTask/);
  const ai = fs.readFileSync("src/lib/services/ai.ts", "utf8");
  assert.match(ai, /looksLikeAddToList|addCarinaTask/);

  console.log("PASS Carina to-do: unattended, approvals inbox, approve-as-requester, reject, exclusions, needs-info, summary");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import {
  classifyError,
  diagnoseError,
  fileBugReport,
  looksLikeWhyDidThatFail,
  memoryErrorStore,
  planFix,
  pushErrorBuffer,
  scrubPayload,
  type CapturedError,
} from "../src/lib/services/carina-errors";

assert.equal(looksLikeWhyDidThatFail("Carina, why did that fail?"), true);
assert.equal(looksLikeWhyDidThatFail("what was that error"), true);
assert.equal(looksLikeWhyDidThatFail("what just went wrong"), true);
assert.equal(looksLikeWhyDidThatFail("How do I fix that error"), false);
assert.equal(looksLikeWhyDidThatFail("Give me the status of my floor"), false);

// Classification
assert.equal(classifyError({ message: "Quantity is required", httpStatus: 400 }).classification, "VALIDATION");
assert.equal(classifyError({ message: "Quantity is required" }).field, "Quantity");
assert.equal(classifyError({ message: "This work order is released and cannot be edited" }).classification, "STATUS_LOCK");
assert.equal(classifyError({ message: "This work order is released and cannot be edited" }).errorCode, "LOCK_RELEASED");
assert.equal(classifyError({ message: "Document is already signed" }).errorCode, "LOCK_SIGNED");
assert.equal(classifyError({ httpStatus: 403, message: "Forbidden" }).classification, "PERMISSION");
assert.equal(classifyError({ message: "BOM is uncertified" }).errorCode, "RULE_BOM_UNCERTIFIED");
assert.equal(classifyError({ message: "Insufficient stock for BOLT-4" }).errorCode, "RULE_INSUFFICIENT_STOCK");
assert.equal(classifyError({ message: "Part WIDGET-20 not found", httpStatus: 404 }).classification, "NOT_FOUND");
assert.equal(classifyError({ prismaCode: "P2025" }).classification, "NOT_FOUND");
assert.equal(classifyError({ prismaCode: "P2002", message: "Unique constraint failed" }).classification, "CONFLICT");
assert.equal(classifyError({ httpStatus: 500, message: "Unexpected prisma error", prismaCode: "P2022" }).classification, "SYSTEM");
assert.equal(classifyError({ httpStatus: 500, prismaCode: "P2022" }).errorCode, "SYS_P2022");
assert.equal(classifyError({ httpStatus: 500 }).errorCode, "SYS_INTERNAL");

// The last assertion is wrong if message doesn't include prisma in errorCode when both provided
// classify uses prismaCode -> SYS_${prismaCode} only if no codeHint and (prismaCode || 5xx)
// With prismaCode P2022 and status 500: SYSTEM SYS_P2022. Good.

// Scrub secrets
const scrubbed = scrubPayload({
  quantity: 4,
  password: "hunter2",
  token: "abc",
  note: "Bearer supersecret.token",
  nested: { apiKey: "k-123", partNumber: "BOLT-4" },
})!;
assert.equal(scrubbed.quantity, 4);
assert.equal(scrubbed.password, "[redacted]");
assert.equal(scrubbed.token, "[redacted]");
assert.match(String(scrubbed.note), /\[redacted\]/);
assert.equal((scrubbed.nested as { apiKey: string }).apiKey, "[redacted]");
assert.equal((scrubbed.nested as { partNumber: string }).partNumber, "BOLT-4");

// Fix paths
const validation: CapturedError = {
  correlationId: "C-AAAAAA",
  classification: "VALIDATION",
  errorCode: "VAL_REQUIRED_FIELD",
  message: "Quantity is required",
  route: "/purchasing/pr/new",
  entityType: "PurchaseRequest",
  source: "action",
  actionAttempted: "submit a purchase request",
};
const v = diagnoseError({ event: validation });
assert.equal(v.classification, "VALIDATION");
assert.match(v.spoken, /Quantity is missing or invalid/i);
assert.equal(v.plan.kind, "propose-edit");
assert.equal(v.plan.canApply, true);
assert.equal(v.plan.needsApproval, true);
assert.equal(v.plan.excluded, false);

const signed: CapturedError = {
  correlationId: "C-BBBBBB",
  classification: "STATUS_LOCK",
  errorCode: "LOCK_SIGNED",
  message: "This traveler is already signed",
  route: "/work-orders/wo1",
  entityType: "WorkOrder",
  entityId: "wo1",
  source: "action",
};
const s = diagnoseError({ event: signed });
assert.equal(s.plan.excluded, true);
assert.match(s.spoken, /PIN|signature|can't|cannot|can’t/i);

const perm: CapturedError = {
  correlationId: "C-CCCCCC",
  classification: "PERMISSION",
  errorCode: "PERM_DENIED",
  httpStatus: 403,
  message: "You don’t have permission to approve this",
  source: "client-api",
};
const p = diagnoseError({ event: perm });
assert.equal(p.plan.excluded, true);
assert.match(p.plan.excludedReason || "", /never bypass permissions/i);

const stock: CapturedError = {
  correlationId: "C-DDDDDD",
  classification: "BUSINESS_RULE",
  errorCode: "RULE_INSUFFICIENT_STOCK",
  message: "Insufficient stock for BOLT-4",
  entityType: "Part",
  source: "action",
};
const st = diagnoseError({ event: stock });
assert.equal(st.plan.kind, "propose-pr");
assert.equal(st.plan.canApply, true);
assert.equal(st.plan.needsApproval, false);

const payrollFix = planFix({
  classified: classifyError({ message: "Quantity is required" }),
  event: { ...validation, route: "/hr/payroll", actionAttempted: "run payroll" },
});
assert.equal(payrollFix.excluded, true);

const sys: CapturedError = {
  correlationId: "C-EEEEEE",
  classification: "SYSTEM",
  errorCode: "SYS_INTERNAL",
  httpStatus: 500,
  message: "Column does not exist",
  route: "/work-orders",
  source: "server",
};
const sy = diagnoseError({ event: sys });
assert.equal(sy.plan.kind, "report-bug");
assert.match(sy.spoken, /bug report|workaround/i);

// Store / buffer / bug report path with fixtures
async function main() {
  const store = memoryErrorStore();
  await store.save(validation);
  await store.save(sys);
  const latest = await store.latestForUser("u1");
  // no userId on fixtures — latest is most recently saved
  assert.ok(latest);
  assert.equal(latest!.correlationId, "C-EEEEEE");

  const found = await store.getByCorrelation("c-aaaaaa");
  assert.equal(found?.errorCode, "VAL_REQUIRED_FIELD");

  await store.markResolution("C-AAAAAA", "FIXED", "carina");
  const fixed = await store.getByCorrelation("C-AAAAAA");
  assert.equal(fixed?.resolution, "FIXED");

  await store.markBugReported("C-EEEEEE");
  const reported = await store.getByCorrelation("C-EEEEEE");
  assert.equal(reported?.bugStatus, "OPEN");
  assert.equal(reported?.resolution, "REPORTED");

  const buf = pushErrorBuffer([], validation);
  const buf2 = pushErrorBuffer(buf, sys);
  assert.equal(buf2[0].correlationId, "C-EEEEEE");
  assert.equal(buf2.length, 2);

  // fileBugReport is prisma-backed — not called here (fixtures only)
  void fileBugReport;

  console.log("test-carina-errors: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

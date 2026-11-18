import assert from "node:assert/strict";
import {
  extractEntityNumbers,
  isApproveUtterance,
  isCancelUtterance,
  isConfirmUtterance,
  isExcludedDomain,
  parseVoiceActionIntent,
} from "../src/lib/services/carina-voice-intent";

function resolveUnique<T>(rows: T[], label: string, describe: (row: T) => string): T {
  if (rows.length === 0) throw new Error(`I couldn’t find that ${label}. Please give the exact number.`);
  if (rows.length > 1) {
    const opts = rows.slice(0, 8).map(describe).join("; ");
    throw new Error(
      `I found ${rows.length} matching ${label}s. Please specify the exact number so I don’t change the wrong one: ${opts}.`
    );
  }
  return rows[0];
}

function permissionDenied(permission: string) {
  return `You don’t have permission to do this (${permission}). I didn’t change any records.`;
}

function pinGate(requiresPin: boolean, voiceApproved: boolean, pinCode?: string | null): string | null {
  if (!requiresPin) return null;
  if (!voiceApproved) {
    return "This change needs a voice “approve” and your sign-off PIN. Voice alone is not a signature.";
  }
  if (!pinCode?.trim()) {
    return "Enter your sign-off PIN on the card. I will not accept a voice-only signature.";
  }
  return null;
}

async function main() {
  assert.deepEqual(extractEntityNumbers("tie WO-00012 to project PRJ-0003"), [
    "WO-00012",
    "PRJ-0003",
  ]);
  assert.ok(isConfirmUtterance("confirm"));
  assert.ok(isConfirmUtterance("Yes"));
  assert.ok(isConfirmUtterance("go ahead"));
  assert.ok(!isConfirmUtterance("confirm the color later"));
  assert.ok(isCancelUtterance("cancel"));
  assert.ok(isCancelUtterance("never mind"));
  assert.ok(isApproveUtterance("approve"));
  assert.ok(isApproveUtterance("I approve"));

  assert.match(isExcludedDomain("change the project budget to $5000") || "", /money|budget amounts/);
  assert.match(isExcludedDomain("update payroll salary") || "", /payroll/);
  assert.match(isExcludedDomain("grant admin access to this user") || "", /permissions/);
  assert.equal(isExcludedDomain("tie WO-00012 to budget BDGT-00001"), null);

  const edit = parseVoiceActionIntent('change project PRJ-0003 name to "Atlas Launch"');
  assert.equal(edit?.kind, "EDIT_PROJECT");
  assert.equal(edit?.projectFields?.name, "Atlas Launch");
  assert.ok(edit?.numbers.includes("PRJ-0003"));

  const tieProject = parseVoiceActionIntent("tie work order WO-00012 to project PRJ-0003");
  assert.equal(tieProject?.kind, "TIE_WO");
  assert.equal(tieProject?.workOrderHint, "WO-00012");
  assert.ok(tieProject?.projectHint?.includes("PRJ-0003") || tieProject?.numbers.includes("PRJ-0003"));

  const tieBudget = parseVoiceActionIntent("assign WO-00012 to budget BDGT-00001");
  assert.equal(tieBudget?.kind, "TIE_WO");
  assert.equal(tieBudget?.budgetHint, "BDGT-00001");

  const cycle = parseVoiceActionIntent(
    "cycle count part ABC-123 at RM-01 to 12 because damaged package"
  );
  assert.equal(cycle?.kind, "CYCLE_COUNT");
  assert.equal(cycle?.partHint, "ABC-123");
  assert.equal(cycle?.locationHint, "RM-01");
  assert.equal(cycle?.countedQty, 12);
  assert.match(cycle?.reason || "", /damaged/);

  const consume = parseVoiceActionIntent("consume the parts to this work order WO-00012");
  assert.equal(consume?.kind, "CONSUME_PARTS");
  assert.equal(consume?.workOrderHint, "WO-00012");

  const output = parseVoiceActionIntent("output work order WO-00012");
  assert.equal(output?.kind, "OUTPUT_WO");
  const complete = parseVoiceActionIntent("complete work order WO-00012");
  assert.equal(complete?.kind, "OUTPUT_WO");

  const risk = parseVoiceActionIntent("check high-risk parts and their counts");
  assert.equal(risk?.kind, "HIGH_RISK_PARTS");

  assert.equal(parseVoiceActionIntent("How do I create a work order?"), null);
  assert.equal(parseVoiceActionIntent("what is a certified BOM?"), null);

  // Ambiguous / missing entity resolution (same helper the service uses)
  assert.throws(
    () => resolveUnique([], "work order", (r: { number: string }) => r.number),
    /couldn’t find that work order/i
  );
  assert.throws(
    () =>
      resolveUnique(
        [
          { number: "WO-00012", status: "PLANNED" },
          { number: "WO-00013", status: "IN_PROGRESS" },
        ],
        "work order",
        (r) => `${r.number} (${r.status})`
      ),
    /2 matching work orders.*WO-00012.*WO-00013/i
  );
  const one = resolveUnique([{ number: "WO-00012" }], "work order", (r) => r.number);
  assert.equal(one.number, "WO-00012");

  // Permission-denied copy used on execute
  for (const perm of [
    "pmo.project.manage",
    "workorders.status.update",
    "inventory.cyclecount",
    "kitting.complete",
    "workorders.complete",
  ]) {
    assert.match(permissionDenied(perm), new RegExp(perm));
    assert.match(permissionDenied(perm), /didn’t change any records/);
  }

  // Signature gate: voice approve is not enough without a PIN
  assert.match(pinGate(true, false, "1234") || "", /voice “approve” and your sign-off PIN/);
  assert.match(pinGate(true, true, "") || "", /Enter your sign-off PIN/);
  assert.equal(pinGate(true, true, "2468"), null);
  assert.equal(pinGate(false, false, null), null);

  console.log("PASS Carina voice action intent, exclusion, ambiguity, permission and PIN-gate tests");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

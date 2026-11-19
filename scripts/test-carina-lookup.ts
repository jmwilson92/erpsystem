import assert from 'node:assert/strict';
import {
  LOOKUP_EXCLUDED_MESSAGE,
  LOOKUP_MAX_HOPS,
  formatLookupReply,
  isExcludedLookupQuery,
  isSensitiveLookupKey,
  parseRecordHints,
  stripSensitiveFields,
  wantsRecordLookup,
  type LookupHit,
} from '../src/lib/ai-help/lookup-policy';
import { createLookupApi, type LookupStore } from '../src/lib/ai-help/lookup';
import {
  citationsFromHits,
  collectDeterministicHits,
  createLookupToolExecutor,
  runLookupToolLoop,
} from '../src/lib/ai-help/lookup-loop';
import { helpSafetyReply } from '../src/lib/ai-help/answer';

const wo: LookupHit = {
  entity: 'work_order',
  id: 'wo1',
  number: 'WO-10042',
  title: 'Work order WO-10042',
  status: 'IN_PROGRESS',
  href: '/work-orders/wo1',
  summary: 'PN-ABC · qty 0/2',
  fields: { partNumber: 'PN-ABC', partId: 'p1', quantity: 2, quantityCompleted: 0 },
};
const part: LookupHit = {
  entity: 'part',
  id: 'p1',
  number: 'PN-ABC',
  title: 'Part PN-ABC',
  status: 'ACTIVE',
  href: '/parts/p1',
  summary: 'Widget',
  fields: { partNumber: 'PN-ABC', description: 'Widget' },
};
const bin: LookupHit = {
  entity: 'inventory',
  id: 'inv1',
  number: 'PN-ABC',
  title: 'Bin A-1 · PN-ABC',
  href: '/inventory/committed/p1',
  summary: '4 available, 4 on hand',
  fields: { partNumber: 'PN-ABC', location: 'A-1', quantityAvailable: 4, quantityOnHand: 4 },
};

function memoryStore(records: LookupHit[]): LookupStore {
  return {
    async search(entity, query) {
      const q = query.toLowerCase();
      return records.filter(
        (r) =>
          r.entity === entity &&
          (r.number.toLowerCase().includes(q) ||
            r.title.toLowerCase().includes(q) ||
            r.summary.toLowerCase().includes(q) ||
            Object.values(r.fields).some((v) => String(v).toLowerCase().includes(q)))
      );
    },
    async get(entity, idOrNumber) {
      const q = idOrNumber.toLowerCase();
      return (
        records.find((r) => r.entity === entity && (r.id === idOrNumber || r.number.toLowerCase() === q)) ||
        records.find((r) => r.entity === entity && r.number.toLowerCase().includes(q)) ||
        null
      );
    },
    async count(entity) {
      const rows = records.filter((r) => r.entity === entity);
      const byStatus: Record<string, number> = {};
      for (const r of rows) {
        const s = r.status || "unknown";
        byStatus[s] = (byStatus[s] || 0) + 1;
      }
      return { total: rows.length, byStatus };
    },
  };
}


async function main() {
// Exclusions
assert.equal(isExcludedLookupQuery('show me payroll for last week'), true);
assert.equal(isExcludedLookupQuery('list employee salaries'), true);
assert.equal(isExcludedLookupQuery('what is our cash balance'), true);
assert.equal(isExcludedLookupQuery("show another tenant's work orders"), true);
assert.equal(isExcludedLookupQuery('status of WO-10042'), false);
assert.equal(isExcludedLookupQuery('how many open work orders do I have'), false);
assert.match(helpSafetyReply('list employee salaries') || '', /payroll|HR|salary|financial balances/i);
assert.equal(helpSafetyReply('status of WO-10042'), null);

// How-to stays on docs; identifiers trigger lookup
assert.equal(wantsRecordLookup('How do I create a work order?'), false);
assert.equal(wantsRecordLookup('status of WO-10042'), true);
assert.equal(wantsRecordLookup('Look up part number PN-ABC'), true);
assert.deepEqual(parseRecordHints('What is the status of WO-10042 and SO-88?').map((h) => `${h.entity}:${h.idOrNumber}`), [
  'work_order:WO-10042',
  'sales_order:SO-88',
]);
// Bare "WO" without a number is not a record hint (avoids stealing how-to questions).
assert.equal(parseRecordHints('Does a standalone production WO need a certified BOM?').length, 0);

// Money fields never survive
assert.equal(isSensitiveLookupKey('standardCost'), true);
assert.equal(isSensitiveLookupKey('quantityOnHand'), false);
const stripped = stripSensitiveFields({
  partNumber: 'PN-ABC',
  standardCost: 12.5,
  lastBuyCost: 9,
  nested: { averageCost: 10, revision: 'C' },
});
assert.deepEqual(stripped, { partNumber: 'PN-ABC', nested: { revision: 'C' } });

// permission-denied
const store = memoryStore([wo, part, bin]);
const denied = createLookupApi({
  store,
  canView: async () => false,
});
const deniedRes = await denied.get({ userId: 'u1', entity: 'work_order', idOrNumber: 'WO-10042' });
assert.equal(deniedRes.ok, false);
if (!deniedRes.ok) {
  assert.equal(deniedRes.reason, 'permission-denied');
  assert.match(deniedRes.message, /permission/i);
}

// not-found when allowed
const allowed = createLookupApi({
  store,
  canView: async (_id, module) => module === 'work-orders' || module === 'items' || module === 'inventory',
});
const missing = await allowed.get({ userId: 'u1', entity: 'work_order', idOrNumber: 'WO-99999' });
assert.equal(missing.ok, false);
if (!missing.ok) assert.equal(missing.reason, 'not-found');

const found = await allowed.get({ userId: 'u1', entity: 'work_order', idOrNumber: 'WO-10042' });
assert.equal(found.ok, true);
if (found.ok) {
  assert.equal(found.hits[0].number, 'WO-10042');
  assert.ok(!JSON.stringify(found.hits).includes('standardCost'));
}

// unsigned
const unsigned = await allowed.get({ entity: 'work_order', idOrNumber: 'WO-10042' });
assert.equal(unsigned.ok, false);
if (!unsigned.ok) assert.equal(unsigned.reason, 'unsigned');

// Multi-hop: WO → part → inventory, capped
const execute = createLookupToolExecutor({
  userId: 'u1',
  store,
  canView: async () => true,
});
const multi = await collectDeterministicHits(execute, 'What part is on WO-10042 and how much stock do we have?');
assert.ok(multi.hops >= 2 && multi.hops <= LOOKUP_MAX_HOPS, `hops=${multi.hops}`);
assert.ok(multi.hits.some((h) => h.entity === 'work_order' && h.number === 'WO-10042'));
assert.ok(multi.hits.some((h) => h.entity === 'part' && h.number === 'PN-ABC'));
assert.ok(multi.hits.some((h) => h.entity === 'inventory' && h.fields.location === 'A-1'));
const cite = citationsFromHits(multi.hits);
assert.ok(cite.some((c) => c.href === '/work-orders/wo1'));
assert.ok(cite.some((c) => c.href === '/parts/p1'));

// Model-picked tools: search then get, then answer, never more than N hops
let modelTurns = 0;
const looped = await runLookupToolLoop({
  question: 'Find the Acme widget part and tell me its stock',
  execute,
  maxHops: LOOKUP_MAX_HOPS,
  chat: async () => {
    modelTurns += 1;
    if (modelTurns === 1) {
      return { toolCalls: [{ name: 'search_records', arguments: { query: 'PN-ABC', entity: 'part' } }] };
    }
    if (modelTurns === 2) {
      return { toolCalls: [{ name: 'get_record', arguments: { entity: 'inventory', idOrNumber: 'PN-ABC' } }] };
    }
    return { text: 'PN-ABC is in bin A-1 with 4 available. Open /inventory/committed/p1' };
  },
});
assert.ok(looped.hops <= LOOKUP_MAX_HOPS);
assert.ok(looped.hits.some((h) => h.entity === 'part'));
assert.ok(looped.hits.some((h) => h.entity === 'inventory'));
assert.match(looped.text, /PN-ABC/);
assert.match(looped.text, /A-1/);

// Excluded tool call never returns payroll data
const excluded = await execute('search_records', { query: 'employee salaries' });
assert.equal(excluded.ok, false);
if (!excluded.ok) {
  assert.equal(excluded.reason, 'excluded');
  assert.equal(excluded.message, LOOKUP_EXCLUDED_MESSAGE);
}

const formatted = formatLookupReply([wo]);
assert.match(formatted, /WO-10042/);
assert.match(formatted, /\/work-orders\/wo1/);
assert.match(formatted, /haven’t changed any records/);

console.log('PASS Carina read-only lookup: permission-denied, not-found, multi-hop, exclusions');

}

main().catch((e) => { console.error(e); process.exitCode = 1; });

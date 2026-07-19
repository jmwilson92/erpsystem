/**
 * Master verification runner.
 *
 *   npx tsx scripts/verify/run-all.ts
 *   npx tsx scripts/verify/run-all.ts --chunk=A,B,C
 *   npx tsx scripts/verify/run-all.ts --skip-http
 */
import { prisma } from "../../src/lib/db";

type ChunkFn = () => Promise<{ pass: number; fail: number }>;

async function main() {
  const args = process.argv.slice(2);
  const chunkArg = args.find((a) => a.startsWith("--chunk="));
  const skipHttp = args.includes("--skip-http");
  const only = chunkArg
    ? chunkArg
        .replace("--chunk=", "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
    : null;

  const chunks: { id: string; name: string; run: () => Promise<ChunkFn> }[] = [
    {
      id: "A",
      name: "Database",
      run: async () => (await import("./chunk-a-db")).runChunkA,
    },
    {
      id: "B",
      name: "Auth",
      run: async () => (await import("./chunk-b-auth")).runChunkB,
    },
    {
      id: "C",
      name: "Sales",
      run: async () => (await import("./chunk-c-sales")).runChunkC,
    },
    {
      id: "C2",
      name: "Money path",
      run: async () => (await import("./chunk-c2-money-path")).runChunkC2,
    },
    {
      id: "D",
      name: "Supply",
      run: async () => (await import("./chunk-d-supply")).runChunkD,
    },
    {
      id: "E",
      name: "Manufacturing",
      run: async () => (await import("./chunk-e-mfg")).runChunkE,
    },
    {
      id: "F",
      name: "Quality",
      run: async () => (await import("./chunk-f-quality")).runChunkF,
    },
    {
      id: "G",
      name: "PMO",
      run: async () => (await import("./chunk-g-pmo")).runChunkG,
    },
    {
      id: "H",
      name: "HR",
      run: async () => (await import("./chunk-h-hr")).runChunkH,
    },
    {
      id: "I",
      name: "Accounting",
      run: async () => (await import("./chunk-i-accounting")).runChunkI,
    },
    {
      id: "S",
      name: "Serials+RMA",
      run: async () => (await import("./chunk-serials-rma")).runChunkSerialsRma,
    },
    {
      id: "J",
      name: "HTTP",
      run: async () => (await import("./chunk-j-http")).runChunkJ,
    },
  ];

  console.log("ForgeRP verification suite");
  console.log("==========================");

  let totalFail = 0;
  let totalPass = 0;

  for (const c of chunks) {
    if (only && !only.includes(c.id)) continue;
    if (skipHttp && c.id === "J") continue;
    try {
      const fn = await c.run();
      const s = await fn();
      totalPass += s.pass;
      totalFail += s.fail;
    } catch (e) {
      totalFail += 1;
      console.error(`Chunk ${c.id} crashed:`, e);
    }
  }

  console.log("\n══════════════════════════════");
  console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed`);
  console.log("══════════════════════════════");

  await prisma.$disconnect().catch(() => null);
  process.exit(totalFail > 0 ? 1 : 0);
}

main();

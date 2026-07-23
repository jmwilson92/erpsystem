import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regenerate e2e/crawl-urls.json for the full-crawl spec: every static page
 * route (enumerated from src/app) plus one real id per dynamic route resolved
 * from the seeded DB. Run after seeding public:  npx tsx scripts/e2e-dump-ids.ts
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// dynamic route template -> prisma model whose first row supplies the id
const DYNAMIC: Record<string, string> = {
  "/items/[id]": "part",
  "/parts/[id]": "part",
  "/bom/[id]": "bomHeader",
  "/work-orders/[id]": "workOrder",
  "/sales/[id]": "salesOrder",
  "/sales/quotes/[id]": "quote",
  "/purchasing/po/[id]": "purchaseOrder",
  "/purchasing/pr/[id]": "purchaseRequest",
  "/customers/[id]": "customer",
  "/suppliers/[id]": "supplier",
  "/receiving/[id]": "receivingTraveler",
  "/shipping/[id]": "shipment",
  "/hr/person/[id]": "user",
  "/hr/timesheet/[id]": "timesheet",
  "/pmo/projects/[id]": "project",
  "/pmo/programs/[id]": "program",
  "/projects/[id]": "project",
  "/assets/[id]": "asset",
  "/virtual-assets/[id]": "virtualAsset",
  "/work-instructions/[id]": "workInstruction",
  "/test-procedures/[id]": "testProcedure",
  "/accounting/account/[id]": "account",
  "/budgets/[id]": "budget",
  "/government-property/[id]": "governmentProperty",
  "/workcenters/[id]": "workCenter",
};

function staticRoutes(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      if (entry.name === "page.tsx") out.push(base || "/");
      continue;
    }
    if (entry.name.includes("[")) continue; // dynamic — handled separately
    if (entry.name.startsWith("(") || entry.name === "api") continue;
    out.push(...staticRoutes(join(dir, entry.name), `${base}/${entry.name}`));
  }
  return out;
}

async function first(model: string): Promise<string | null> {
  try {
    // @ts-expect-error dynamic model access
    const row = await prisma[model].findFirst({ select: { id: true } });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const urls: Record<string, string> = {};
  for (const r of staticRoutes(join(process.cwd(), "src/app"))) urls[r] = r;
  for (const [tpl, model] of Object.entries(DYNAMIC)) {
    const id = await first(model);
    if (id) urls[tpl] = tpl.replace(/\[[^\]]+\]/, id);
  }
  try {
    // @ts-expect-error dynamic
    const row = await prisma.qualityProgram.findFirst({ select: { key: true } });
    if (row?.key) urls["/quality/programs/[key]"] = `/quality/programs/${row.key}`;
  } catch {}
  urls["/legal/[slug]"] = "/legal/terms-of-service";

  writeFileSync(join(process.cwd(), "e2e/crawl-urls.json"), JSON.stringify(urls, null, 2));
  console.log(`wrote e2e/crawl-urls.json with ${Object.keys(urls).length} routes`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

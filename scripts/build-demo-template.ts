import "dotenv/config";
import { Pool } from "pg";
import { execSync } from "node:child_process";
import { TENANT_TEMPLATE_SQL } from "../src/lib/tenant-template";

/**
 * Build (or rebuild) the `demo_template` schema: the pre-seeded schema every
 * throwaway demo is cloned from. Run once after deploy and again whenever the
 * schema or demo seed changes:
 *
 *   npx tsx scripts/build-demo-template.ts
 */
const SCHEMA = "demo_template";
const conn = (process.env.DIRECT_URL || process.env.DATABASE_URL) as string;

async function main() {
  const pool = new Pool({ connectionString: conn, max: 1 });
  const c = await pool.connect();
  await c.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await c.query(`CREATE SCHEMA "${SCHEMA}"`);
  await c.query(`SET search_path TO "${SCHEMA}";\n${TENANT_TEMPLATE_SQL}`);
  c.release();
  await pool.end();
  console.log(`✓ provisioned ${SCHEMA} — seeding demo data...`);

  execSync(`npx tsx prisma/seed.ts`, {
    stdio: "inherit",
    env: { ...process.env, SEED_SCHEMA: SCHEMA },
  });

  console.log(`\n✅ demo template ready (${SCHEMA})`);
}

main().catch((e) => {
  console.error("build-demo-template failed:", e);
  process.exit(1);
});

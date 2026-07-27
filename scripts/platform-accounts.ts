/**
 * Show what sign-in accounts actually exist, so you never have to guess why a
 * login fails.
 *
 * Lists every account on the **platform** (public/dogfood) schema — the ones
 * that can open the staff desk at /admin/support and /admin/insights — with
 * whether each is active, an ADMIN, and has a password set. Then lists the
 * TenantLogin directory, which routes an address to a customer schema instead.
 *
 * Read-only: it changes nothing.
 *
 * Usage:
 *   npx tsx scripts/platform-accounts.ts
 *   npx tsx scripts/platform-accounts.ts --like forge     # filter by substring
 *
 * Requires DATABASE_URL or DIRECT_URL (same as the other scripts).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function yn(v: boolean): string {
  return v ? "yes" : "NO";
}

async function main() {
  const like = (arg("--like") || "").trim().toLowerCase();

  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  if (!connectionString) {
    console.error(
      "No DATABASE_URL or DIRECT_URL set. Add it to .env (use the *.pooler.supabase.com host) and re-run."
    );
    process.exit(1);
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const users = await db.user.findMany({
      where: like ? { email: { contains: like, mode: "insensitive" } } : undefined,
      select: {
        email: true,
        name: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
      orderBy: { email: "asc" },
      take: 200,
    });

    console.log("\n=== PLATFORM accounts (public schema) ===");
    console.log("These can sign in at /login and reach the staff desk if ADMIN.\n");
    if (users.length === 0) {
      console.log("  (none found)");
      console.log("\n  Create one:");
      console.log(
        '    npx tsx scripts/create-platform-admin.ts --email you@example.com --name "Your Name"'
      );
    } else {
      const pad = Math.max(...users.map((u) => u.email.length), 5);
      console.log(
        `  ${"EMAIL".padEnd(pad)}  ${"ROLE".padEnd(10)}  ACTIVE  PASSWORD SET  CAN OPEN STAFF DESK`
      );
      for (const u of users) {
        const canStaff = u.role === "ADMIN" && u.isActive && !!u.passwordHash;
        console.log(
          `  ${u.email.padEnd(pad)}  ${u.role.padEnd(10)}  ${yn(u.isActive).padEnd(6)}  ${yn(
            !!u.passwordHash
          ).padEnd(12)}  ${canStaff ? "YES" : "no"}`
        );
      }
    }

    const dir = await db.tenantLogin.findMany({
      where: like ? { email: { contains: like, mode: "insensitive" } } : undefined,
      select: { email: true, schemaName: true },
      orderBy: { email: "asc" },
      take: 200,
    });

    console.log("\n=== TENANT login directory ===");
    console.log(
      "These addresses sign in to a CUSTOMER instance, not the platform.\n"
    );
    if (dir.length === 0) {
      console.log("  (none)");
    } else {
      for (const d of dir) console.log(`  ${d.email}  ->  ${d.schemaName}`);
    }

    // The overlap that used to lock the owner out (now handled in login, but
    // still worth seeing).
    const emails = new Set(users.map((u) => u.email.toLowerCase()));
    const both = dir.filter((d) => emails.has(d.email.toLowerCase()));
    if (both.length > 0) {
      console.log("\n=== IN BOTH ===");
      console.log(
        "  Platform account wins on login; the tenant password still opens the tenant."
      );
      for (const d of both) console.log(`  ${d.email}`);
    }

    console.log("\nTo (re)set a platform admin password:");
    console.log(
      '  npx tsx scripts/create-platform-admin.ts --email you@example.com --name "Your Name"\n'
    );
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });

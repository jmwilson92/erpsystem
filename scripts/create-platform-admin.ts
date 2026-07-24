/**
 * Create or update a ForgeRP **platform** (public/dogfood) ADMIN account.
 * Does NOT create a customer tenant user.
 *
 * Also removes any TenantLogin row for that email so login routes to public
 * instead of a customer schema (required if this email was used for a tenant).
 *
 * Usage:
 *   npx tsx scripts/create-platform-admin.ts \
 *     --email forgerplanning@gmail.com \
 *     --name "Jeramey Wilson" \
 *     [--password 'YourTempPassword123']
 *
 * Requires DATABASE_URL or DIRECT_URL in .env / environment.
 */
import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function genPassword() {
  // Readable + strong temp password
  const a = randomBytes(4).toString("hex");
  const b = randomBytes(3).toString("hex");
  return `Forge-${a}-${b}!`;
}

async function main() {
  const email = (arg("--email") || "").trim().toLowerCase();
  const name = (arg("--name") || "").trim() || email.split("@")[0];
  const password = arg("--password") || genPassword();

  if (!email || !email.includes("@")) {
    console.error("Usage: --email you@example.com --name \"Full Name\" [--password ...]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters");
    process.exit(1);
  }

  const connectionString =
    process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  if (!connectionString) {
    console.error(
      "No DATABASE_URL or DIRECT_URL set. Add them to .env or export them, then re-run."
    );
    process.exit(1);
  }

  // Always public schema for platform admin
  const adapter = new PrismaPg({ connectionString });
  const db = new PrismaClient({ adapter });

  try {
    // Unbind this email from any customer tenant so login hits public
    const removed = await db.tenantLogin
      .deleteMany({ where: { email } })
      .catch(() => ({ count: 0 }));
    if (removed.count > 0) {
      console.log(
        `Removed ${removed.count} TenantLogin row(s) for ${email} (was routing to a customer schema).`
      );
    }

    const existing = await db.user.findFirst({ where: { email } });
    const passwordHash = hashPassword(password);

    const user = existing
      ? await db.user.update({
          where: { id: existing.id },
          data: {
            name,
            role: "ADMIN",
            isActive: true,
            passwordHash,
          },
        })
      : await db.user.create({
          data: {
            email,
            name,
            role: "ADMIN",
            isActive: true,
            passwordHash,
          },
        });

    console.log("");
    console.log("Platform ADMIN ready (public / dogfood schema)");
    console.log("─────────────────────────────────────────────");
    console.log(`  Name:  ${user.name}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Role:  ${user.role}`);
    console.log(`  Id:    ${user.id}`);
    console.log(`  ${existing ? "Updated existing user" : "Created new user"}`);
    console.log("");
    console.log("  Temporary password (save now):");
    console.log(`  ${password}`);
    console.log("");
    console.log("Log in at https://www.forge-rp.live/login");
    console.log("Then open /admin/support for the staff desk.");
    console.log("Change the password under My Account after first login.");
    console.log("");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

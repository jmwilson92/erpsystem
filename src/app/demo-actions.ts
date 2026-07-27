"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_COOKIE } from "@/lib/db";

/**
 * Demo start / re-enter only. Ending a drive uses GET /api/demo/end
 * (full browser navigation) so we never leave a half-dead ERP shell.
 */

export async function actionStartTestDrive(): Promise<void> {
  const jar = await cookies();
  const stale = jar.get(DEMO_COOKIE)?.value;
  if (stale) {
    jar.delete(DEMO_COOKIE);
    jar.delete("forge-demo-user");
    if (stale !== "demo_template" && /^demo_[a-z0-9]{6,40}$/.test(stale)) {
      void import("@/lib/services/tenancy")
        .then((m) => m.destroyTenant(stale))
        .catch(() => undefined);
    }
  }

  const { provisionDemo, demoTemplateExists } = await import(
    "@/lib/services/tenancy"
  );
  if (!(await demoTemplateExists())) {
    console.error("[demo] demo_template schema missing — run build-demo-template");
    redirect("/welcome?error=warming");
  }

  let schemaName: string;
  try {
    const tenant = await provisionDemo();
    schemaName = tenant.schemaName;
  } catch (err) {
    console.error("[demo] provisionDemo failed:", err);
    redirect("/welcome?error=warming");
  }

  try {
    const { clientForSchema } = await import("@/lib/db");
    const n = await clientForSchema(schemaName).user.count();
    if (n < 1) throw new Error("cloned demo has zero users");
  } catch (err) {
    console.error("[demo] clone validation failed:", err);
    void import("@/lib/services/tenancy")
      .then((m) => m.destroyTenant(schemaName))
      .catch(() => undefined);
    redirect("/welcome?error=warming");
  }

  jar.set(DEMO_COOKIE, schemaName, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 4,
  });
  jar.delete("forge-demo-user");
  redirect("/?app=1");
}

/** Cookie already set — skip provision, enter the plant after the splash. */
export async function actionEnterExistingDemo(): Promise<void> {
  const jar = await cookies();
  const schema = jar.get(DEMO_COOKIE)?.value;
  if (
    !schema ||
    schema === "demo_template" ||
    !/^demo_[a-z0-9]{6,40}$/.test(schema)
  ) {
    redirect("/");
  }
  try {
    const { clientForSchema } = await import("@/lib/db");
    const n = await clientForSchema(schema).user.count();
    if (n < 1) throw new Error("empty demo");
    void import("@/lib/services/tenancy")
      .then((m) => m.touchTenant(schema))
      .catch(() => undefined);
  } catch {
    jar.delete(DEMO_COOKIE);
    jar.delete("forge-demo-user");
    redirect("/");
  }
  redirect("/?app=1");
}

/** Prefer GET /api/demo/end from the UI; kept for form compatibility. */
export async function actionEndTestDrive(): Promise<void> {
  const jar = await cookies();
  const schema = jar.get(DEMO_COOKIE)?.value;
  jar.delete(DEMO_COOKIE);
  jar.delete("forge-demo-user");
  if (
    schema &&
    schema !== "demo_template" &&
    /^demo_[a-z0-9]{6,40}$/.test(schema)
  ) {
    void import("@/lib/services/tenancy")
      .then((m) => m.destroyTenant(schema))
      .catch(() => undefined);
  }
  redirect("/welcome?ended=1");
}

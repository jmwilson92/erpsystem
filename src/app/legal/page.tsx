import { prisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** Beta terms + privacy in plain language — linked from the login page. */
export default async function LegalPage() {
  const company = await prisma.companySettings.findUnique({
    where: { id: "default" },
  });
  const name = company?.name || "ForgeRP";

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-12 text-sm leading-6 text-slate-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-50">
          {name} — Beta Terms &amp; Privacy
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Plain-language summary for the beta program.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-100">Beta terms</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            This is <strong>beta software</strong>, provided as-is. Features
            may change, and defects are possible — keep independent records of
            anything business-critical.
          </li>
          <li>
            Your account is for you; don&apos;t share credentials. Admins can
            deactivate accounts and control role permissions.
          </li>
          <li>
            No warranty and no liability for indirect or consequential damages
            to the extent permitted by law. Use in regulated or
            safety-critical processes is your responsibility to validate.
          </li>
          <li>We may suspend the service for maintenance or security.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-100">Privacy</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            We store what you put in: business records (orders, parts, work
            orders) and account details (name, e-mail, role). Passwords are
            stored only as salted hashes.
          </li>
          <li>
            Actions are audit-logged (who did what, when) — that&apos;s an ERP
            feature, and your admins can see it.
          </li>
          <li>
            Data lives in this instance&apos;s database and its backups. We
            don&apos;t sell it or share it with third parties, other than the
            infrastructure it runs on (hosting, and e-mail delivery when
            configured).
          </li>
          <li>
            Want your account or data removed? Ask your admin or contact
            support; we&apos;ll handle deletion requests within 30 days.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-100">Support</h2>
        <p>
          Found a bug or need help? Contact your instance admin, or the beta
          support contact listed in your onboarding note. Include the page you
          were on and any reference code from the error screen.
        </p>
      </section>

      <p className="border-t border-slate-800 pt-4 text-xs text-slate-600">
        <Link href="/login" className="text-teal-500 hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </div>
  );
}

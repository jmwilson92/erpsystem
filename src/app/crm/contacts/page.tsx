import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { listContacts } from "@/lib/services/crm";
import { checkModuleHealth } from "@/lib/services/module-health";
import { ModuleNotMigrated } from "@/components/shared/module-not-migrated";
import { actionCreateContact } from "../actions";
import { Star } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

export default async function ContactsPage() {
  const health = await checkModuleHealth(() => listContacts());
  if (!health.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Contacts" description="People, not just companies." />
        <ModuleNotMigrated module="CRM" health={health} />
      </div>
    );
  }

  const [contacts, customers] = await Promise.all([
    listContacts(),
    prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        description="People rather than companies. A Customer record holds one contact field — this is where the buyer, the engineer, and the person who signs off actually live."
      />

      <Link href="/crm" className="inline-block text-xs text-teal-300 hover:underline">
        ← Pipeline
      </Link>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Contacts <span className="text-xs font-normal text-slate-500">({contacts.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-10 text-center text-sm text-slate-500">
              No contacts yet — add one below.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Name</th>
                    <th className="pb-2 pr-3 font-medium">Title</th>
                    <th className="pb-2 pr-3 font-medium">Account</th>
                    <th className="pb-2 pr-3 font-medium">Email</th>
                    <th className="pb-2 font-medium">Phone</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {contacts.map((c) => (
                    <tr key={c.id} className="text-slate-300">
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-1.5 font-medium text-slate-200">
                          {c.isPrimary && (
                            <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                          )}
                          {c.name}
                        </span>
                        {c.notes && (
                          <div className="text-[11px] text-slate-500">{c.notes}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">{c.title || "—"}</td>
                      <td className="py-2 pr-3 text-xs">
                        {c.customerId ? customerName.get(c.customerId) || "—" : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {c.email ? (
                          <a href={`mailto:${c.email}`} className="text-teal-300 hover:underline">
                            {c.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 text-xs">{c.phone || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Add a contact</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionCreateContact} className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-500">
              Name *
              <Input name="name" required placeholder="Dana Ruiz" />
            </label>
            <label className="text-xs text-slate-500">
              Title
              <Input name="title" placeholder="Purchasing manager" />
            </label>
            <label className="text-xs text-slate-500">
              Account
              <select name="customerId" className={selectClass} defaultValue="">
                <option value="">— unattached —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Email
              <Input name="email" type="email" />
            </label>
            <label className="text-xs text-slate-500">
              Phone
              <Input name="phone" />
            </label>
            <label className="text-xs text-slate-500">
              Primary contact
              <select name="isPrimary" className={selectClass} defaultValue="no">
                <option value="no">No</option>
                <option value="yes">Yes — main contact for this account</option>
              </select>
            </label>
            <label className="text-xs text-slate-500 sm:col-span-3">
              Notes
              <Input name="notes" />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                Add contact
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

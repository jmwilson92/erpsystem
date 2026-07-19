import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionCreateRmaRequest } from "@/app/actions";
import { ActionLoadingForm } from "@/components/layout/action-loading";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function NewRmaPage() {
  const [customers, parts] = await Promise.all([
    prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.part.findMany({
      where: { isActive: true },
      orderBy: { partNumber: "asc" },
      take: 500,
      select: { id: true, partNumber: true, description: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="New RMA request"
        description="Customer serial + part — system looks up as-built and warranty when the SN is in the registry"
        actions={
          <Link href="/rma">
            <Button size="sm" variant="outline">
              Cancel
            </Button>
          </Link>
        }
      />
      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Return request</CardTitle>
          <p className="text-xs text-slate-500">
            If the serial is not in the system yet, pick the catalog part and
            we still open an RMA for evaluation (warranty will show as unknown
            / not eligible until verified). A customer packing list is
            available as soon as the RMA exists.
          </p>
        </CardHeader>
        <CardContent>
          <ActionLoadingForm
            theme="creating"
            action={actionCreateRmaRequest}
            className="grid gap-3"
          >
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Customer *
              </label>
              <select name="customerId" required className={`${selectClass} mt-1`}>
                <option value="">— Select —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Serial number (customer reported) *
              </label>
              <Input
                name="serial"
                required
                className="mt-1 font-mono"
                placeholder="SN-…"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Part (catalog) *
              </label>
              <select name="partId" required className={`${selectClass} mt-1`}>
                <option value="">— Select part —</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber} · {p.description}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-slate-600">
                Required so we know what is coming back even if the SN is new
              </p>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Part number as customer wrote it (optional)
              </label>
              <Input
                name="partNumber"
                className="mt-1 font-mono"
                placeholder="If different from catalog"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Symptom / failure description
              </label>
              <Textarea name="symptom" rows={3} className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Notes
              </label>
              <Textarea name="notes" rows={2} className="mt-1" />
            </div>
            <Button type="submit">Create & evaluate</Button>
          </ActionLoadingForm>
        </CardContent>
      </Card>
    </div>
  );
}

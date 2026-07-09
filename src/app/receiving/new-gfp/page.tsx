import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionCreateGfpTraveler } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewGfpTravelerPage() {
  const [customers, parts] = await Promise.all([
    prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.part.findMany({
      where: { isActive: true },
      orderBy: { partNumber: "asc" },
      select: {
        id: true,
        partNumber: true,
        description: true,
        standardCost: true,
        uom: true,
      },
    }),
  ]);

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="New GFP traveler"
        description="Receive government-furnished property without a purchase order"
        actions={
          <Link href="/receiving">
            <Button size="sm" variant="outline">
              Back to receiving
            </Button>
          </Link>
        }
      />

      <Card>
        <CardContent className="p-6">
          <form action={actionCreateGfpTraveler} className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Customer (optional)
                </label>
                <select name="customerId" className={`${selectClass} mt-1`}>
                  <option value="">— Select customer —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Contract number
                </label>
                <Input
                  name="contractNumber"
                  className="mt-1 font-mono"
                  placeholder="e.g. FA8650-24-C-1234"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">CLIN</label>
                <Input name="clin" className="mt-1 font-mono" placeholder="0001AA" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Expected date
                </label>
                <Input name="expectedDate" type="date" className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Ship from (name)
                </label>
                <Input name="shipFromName" className="mt-1" placeholder="Customer plant" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Ship from address
                </label>
                <Input name="shipFromAddress" className="mt-1" />
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase text-slate-500">Notes</label>
              <Textarea
                name="notes"
                rows={2}
                className="mt-1"
                placeholder="Transfer order, shipping memo, etc."
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Lines (catalog part optional — description required)
              </p>
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-12"
                >
                  <div className="sm:col-span-4">
                    <label className="text-[10px] uppercase text-slate-600">
                      Part (optional)
                    </label>
                    <select
                      name={`line_part_${i}`}
                      className={`${selectClass} mt-0.5`}
                      defaultValue=""
                    >
                      <option value="">— Non-catalog / free text —</option>
                      {parts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.partNumber} — {p.description}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-4">
                    <label className="text-[10px] uppercase text-slate-600">
                      Description
                    </label>
                    <Input
                      name={`line_desc_${i}`}
                      className="mt-0.5"
                      placeholder={i === 0 ? "Required for first line used" : "Optional line"}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="text-[10px] uppercase text-slate-600">Qty</label>
                    <Input
                      name={`line_qty_${i}`}
                      type="number"
                      step="any"
                      className="mt-0.5"
                      defaultValue={i === 0 ? "1" : ""}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="text-[10px] uppercase text-slate-600">UOM</label>
                    <Input name={`line_uom_${i}`} className="mt-0.5" defaultValue="EA" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] uppercase text-slate-600">
                      Unit cost
                    </label>
                    <Input
                      name={`line_cost_${i}`}
                      type="number"
                      step="0.01"
                      className="mt-0.5"
                      defaultValue="0"
                    />
                  </div>
                </div>
              ))}
            </div>

            <Button type="submit">Create GFP traveler</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

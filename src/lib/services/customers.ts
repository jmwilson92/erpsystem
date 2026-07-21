"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export type CustomerInput = {
  code?: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  billToAddress?: string;
  shipToAddress?: string;
  paymentTerms?: string;
  creditLimit?: number;
  creditTermsRequested?: string;
  creditDocUrl?: string;
  creditDocName?: string;
  isActive?: boolean;
  userId?: string;
};

function slugCode(name: string) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 12);
  return base || "CUST";
}

async function uniqueCustomerCode(preferred?: string) {
  let code = (preferred || "").trim().toUpperCase();
  if (!code) {
    const count = await prisma.customer.count();
    code = `CUST-${String(count + 1).padStart(4, "0")}`;
  }
  // Ensure uniqueness
  let attempt = code;
  let n = 1;
  while (await prisma.customer.findUnique({ where: { code: attempt } })) {
    attempt = `${code}-${n}`;
    n += 1;
  }
  return attempt;
}

export async function createCustomer(params: CustomerInput) {
  if (!params.name?.trim()) throw new Error("Customer name is required");

  const code = await uniqueCustomerCode(params.code || slugCode(params.name));

  const customer = await prisma.customer.create({
    data: {
      code,
      name: params.name.trim(),
      contactName: params.contactName?.trim() || null,
      contactEmail: params.contactEmail?.trim() || null,
      contactPhone: params.contactPhone?.trim() || null,
      billToAddress: params.billToAddress?.trim() || null,
      shipToAddress: params.shipToAddress?.trim() || params.billToAddress?.trim() || null,
      paymentTerms: params.paymentTerms || "NET30",
      creditLimit: params.creditLimit ?? 0,
      creditTermsRequested: params.creditTermsRequested?.trim() || null,
      creditDocUrl: params.creditDocUrl?.trim() || null,
      creditDocName: params.creditDocName?.trim() || null,
      isActive: params.isActive ?? true,
    },
  });

  await logAudit({
    entityType: "Customer",
    entityId: customer.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { code: customer.code, name: customer.name },
  });

  return customer;
}

export async function updateCustomer(
  id: string,
  params: CustomerInput & { code?: string }
) {
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw new Error("Customer not found");

  let code = existing.code;
  if (params.code && params.code.trim().toUpperCase() !== existing.code) {
    code = await uniqueCustomerCode(params.code.trim().toUpperCase());
  }

  const customer = await prisma.customer.update({
    where: { id },
    data: {
      code,
      name: params.name?.trim() || existing.name,
      contactName: params.contactName !== undefined ? params.contactName?.trim() || null : undefined,
      contactEmail:
        params.contactEmail !== undefined ? params.contactEmail?.trim() || null : undefined,
      contactPhone:
        params.contactPhone !== undefined ? params.contactPhone?.trim() || null : undefined,
      billToAddress:
        params.billToAddress !== undefined ? params.billToAddress?.trim() || null : undefined,
      shipToAddress:
        params.shipToAddress !== undefined ? params.shipToAddress?.trim() || null : undefined,
      paymentTerms: params.paymentTerms || existing.paymentTerms,
      creditLimit:
        params.creditLimit !== undefined ? params.creditLimit : existing.creditLimit,
      creditTermsRequested:
        params.creditTermsRequested !== undefined
          ? params.creditTermsRequested?.trim() || null
          : undefined,
      creditDocUrl:
        params.creditDocUrl !== undefined
          ? params.creditDocUrl?.trim() || null
          : undefined,
      creditDocName:
        params.creditDocName !== undefined
          ? params.creditDocName?.trim() || null
          : undefined,
      isActive: params.isActive !== undefined ? params.isActive : existing.isActive,
    },
  });

  await logAudit({
    entityType: "Customer",
    entityId: customer.id,
    action: "UPDATED",
    userId: params.userId,
    metadata: { code: customer.code },
  });

  return customer;
}

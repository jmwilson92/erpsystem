import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export type AslPolicyInput = {
  requireIso9001?: boolean;
  requireAs9100d?: boolean;
  allowTrialOrders?: boolean;
  defaultTrialLimit?: number;
  notes?: string | null;
  userId?: string;
};

export async function getAslPolicy() {
  return prisma.aslPolicy.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

export async function updateAslPolicy(params: AslPolicyInput) {
  const policy = await prisma.aslPolicy.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      requireIso9001: params.requireIso9001 ?? false,
      requireAs9100d: params.requireAs9100d ?? false,
      allowTrialOrders: params.allowTrialOrders ?? true,
      defaultTrialLimit: params.defaultTrialLimit ?? 1,
      notes: params.notes ?? null,
    },
    update: {
      ...(params.requireIso9001 !== undefined
        ? { requireIso9001: params.requireIso9001 }
        : {}),
      ...(params.requireAs9100d !== undefined
        ? { requireAs9100d: params.requireAs9100d }
        : {}),
      ...(params.allowTrialOrders !== undefined
        ? { allowTrialOrders: params.allowTrialOrders }
        : {}),
      ...(params.defaultTrialLimit !== undefined
        ? { defaultTrialLimit: params.defaultTrialLimit }
        : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
    },
  });

  await logAudit({
    entityType: "AslPolicy",
    entityId: policy.id,
    action: "UPDATED",
    userId: params.userId,
    metadata: {
      requireIso9001: policy.requireIso9001,
      requireAs9100d: policy.requireAs9100d,
      allowTrialOrders: policy.allowTrialOrders,
    },
  });

  return policy;
}

/** True if cert is present and not expired (expiresAt null = no expiry). */
export function certIsValid(
  cert: { status: string; expiresAt: Date | null },
  asOf: Date = new Date()
) {
  if (cert.status === "REVOKED" || cert.status === "EXPIRED") return false;
  if (cert.expiresAt && cert.expiresAt < asOf) return false;
  return cert.status === "VALID" || cert.status === "PENDING";
}

export async function supplierMeetsCertPolicy(supplierId: string) {
  const [policy, certs] = await Promise.all([
    getAslPolicy(),
    prisma.supplierCertification.findMany({ where: { supplierId } }),
  ]);

  const missing: string[] = [];
  if (policy.requireIso9001) {
    const ok = certs.some(
      (c) => c.certType === "ISO9001" && certIsValid(c)
    );
    if (!ok) missing.push("ISO9001");
  }
  if (policy.requireAs9100d) {
    const ok = certs.some(
      (c) => c.certType === "AS9100D" && certIsValid(c)
    );
    if (!ok) missing.push("AS9100D");
  }

  return {
    policy,
    meetsRequirements: missing.length === 0,
    missingCerts: missing,
  };
}

/**
 * Approve / trial / remove from ASL respecting company cert policy.
 * - Full ASL: meets certs (or no certs required) → APPROVED
 * - Missing certs + allow trial → CONDITIONAL + isTrialVendor
 * - Missing certs + no trial → throw
 */
export async function setSupplierAsl(params: {
  supplierId: string;
  approve: boolean;
  forceTrial?: boolean;
  userId?: string;
}) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: params.supplierId },
  });
  if (!supplier) throw new Error("Supplier not found");

  if (!params.approve) {
    const updated = await prisma.supplier.update({
      where: { id: params.supplierId },
      data: {
        isApprovedVendor: false,
        isTrialVendor: false,
        approvedAt: null,
        approvedById: null,
        status:
          supplier.status === "DISQUALIFIED" ? "DISQUALIFIED" : "PROSPECT",
      },
    });
    await logAudit({
      entityType: "Supplier",
      entityId: updated.id,
      action: "ASL_REMOVED",
      userId: params.userId,
    });
    return updated;
  }

  const check = await supplierMeetsCertPolicy(params.supplierId);
  const policy = check.policy;

  if (check.meetsRequirements && !params.forceTrial) {
    const updated = await prisma.supplier.update({
      where: { id: params.supplierId },
      data: {
        isApprovedVendor: true,
        isTrialVendor: false,
        status: "APPROVED",
        approvedAt: new Date(),
        approvedById: params.userId || null,
      },
    });
    await logAudit({
      entityType: "Supplier",
      entityId: updated.id,
      action: "ASL_APPROVED",
      userId: params.userId,
    });
    return updated;
  }

  // Missing required certs
  if (!policy.allowTrialOrders && !params.forceTrial) {
    throw new Error(
      `Cannot add to ASL: missing required certification(s): ${check.missingCerts.join(", ")}. ` +
        "Upload valid QMS certs or enable trial orders in ASL policy."
    );
  }

  const updated = await prisma.supplier.update({
    where: { id: params.supplierId },
    data: {
      isApprovedVendor: true,
      isTrialVendor: true,
      status: "CONDITIONAL",
      trialOrderLimit: policy.defaultTrialLimit,
      approvedAt: new Date(),
      approvedById: params.userId || null,
    },
  });
  await logAudit({
    entityType: "Supplier",
    entityId: updated.id,
    action: "ASL_TRIAL",
    userId: params.userId,
    metadata: { missingCerts: check.missingCerts },
  });
  return updated;
}

export async function upsertSupplierCertification(params: {
  id?: string;
  supplierId: string;
  certType: string;
  certNumber?: string | null;
  issuedBy?: string | null;
  issuedAt?: Date | null;
  expiresAt?: Date | null;
  documentUrl?: string | null;
  documentName?: string | null;
  notes?: string | null;
  userId?: string;
}) {
  const now = new Date();
  let status = "VALID";
  if (params.expiresAt && params.expiresAt < now) status = "EXPIRED";

  const data = {
    certType: params.certType.trim().toUpperCase(),
    certNumber: params.certNumber?.trim() || null,
    issuedBy: params.issuedBy?.trim() || null,
    issuedAt: params.issuedAt ?? null,
    expiresAt: params.expiresAt ?? null,
    documentUrl: params.documentUrl?.trim() || null,
    documentName: params.documentName?.trim() || null,
    notes: params.notes?.trim() || null,
    status,
  };

  const cert = params.id
    ? await prisma.supplierCertification.update({
        where: { id: params.id },
        data,
      })
    : await prisma.supplierCertification.create({
        data: { supplierId: params.supplierId, ...data },
      });

  await logAudit({
    entityType: "SupplierCertification",
    entityId: cert.id,
    action: params.id ? "UPDATED" : "CREATED",
    userId: params.userId,
    metadata: { certType: cert.certType, supplierId: params.supplierId },
  });

  return cert;
}

export async function deleteSupplierCertification(params: {
  id: string;
  userId?: string;
}) {
  const cert = await prisma.supplierCertification.delete({
    where: { id: params.id },
  });
  await logAudit({
    entityType: "SupplierCertification",
    entityId: cert.id,
    action: "DELETED",
    userId: params.userId,
  });
  return cert;
}

/** Refresh expired status flags on certs. */
export async function refreshCertStatuses(supplierId?: string) {
  const now = new Date();
  await prisma.supplierCertification.updateMany({
    where: {
      ...(supplierId ? { supplierId } : {}),
      expiresAt: { lt: now },
      status: { not: "REVOKED" },
    },
    data: { status: "EXPIRED" },
  });
}

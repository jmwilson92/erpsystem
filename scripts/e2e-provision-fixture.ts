import "dotenv/config";
import { provisionCustomerTenant, issueOnboardingLink } from "../src/lib/services/tenancy";
import { controlPlaneClient } from "../src/lib/db";
import { writeFileSync } from "node:fs";
async function main() {
  const email = `owner+${Date.now()}@acme-e2e.com`;
  const sub = "sub_e2e_" + Date.now();
  const t = await provisionCustomerTenant({
    plan: "GROWTH", billingEmail: email, companyName: "Acme E2E Co",
    trialDays: 45, stripeCustomerId: "cus_e2e", stripeSubscriptionId: sub,
  });
  const { token } = await issueOnboardingLink(t.id);
  writeFileSync("e2e/tenant-fixture.json", JSON.stringify({ email, token, schema: t.schemaName, tenantId: t.id }, null, 2));
  console.log("provisioned tenant fixture:", t.schemaName, email);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

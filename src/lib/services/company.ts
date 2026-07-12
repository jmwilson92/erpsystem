/**
 * Company-wide settings helpers. Departments come from the setup
 * wizard (CompanySettings.departments JSON) so dropdowns across the
 * app follow whatever the company configured, with sane defaults.
 */
import { prisma } from "@/lib/db";

export const DEFAULT_DEPARTMENTS = [
  "Production",
  "Manufacturing",
  "Engineering",
  "Quality",
  "Supply Chain",
  "Programs",
  "Finance",
  "Human Resources",
  "Operations",
];

export async function getCompanyDepartments(): Promise<string[]> {
  const company = await prisma.companySettings.findUnique({
    where: { id: "default" },
  });
  try {
    if (company?.departments) {
      const parsed = JSON.parse(company.departments);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_DEPARTMENTS;
}

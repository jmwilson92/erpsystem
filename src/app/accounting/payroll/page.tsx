import { redirect } from "next/navigation";

// Payroll now lives as a tab inside Accounting.
export default function PayrollRedirect() {
  redirect("/accounting?tab=payroll");
}

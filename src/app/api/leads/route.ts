import { NextResponse } from "next/server";
import { captureSignupLead } from "@/lib/services/signup-lead";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      email?: string;
      company?: string;
      plan?: string;
      seats?: number;
      stage?: "typed" | "submitted";
    };
    await captureSignupLead({
      email: body.email || "",
      company: body.company,
      plan: body.plan,
      seats: body.seats,
      stage: body.stage === "submitted" ? "submitted" : "typed",
    });
  } catch {
    // Never fail the page over a lead write.
  }
  return NextResponse.json({ ok: true });
}

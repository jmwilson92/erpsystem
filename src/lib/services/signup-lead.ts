import { recordEvent } from "@/lib/services/telemetry";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NOTIFY_TO =
  process.env.LEAD_NOTIFY_EMAIL?.trim() || "forgerplanning@gmail.com";

export type SignupLead = {
  email: string;
  company?: string | null;
  plan?: string | null;
  seats?: number | null;
  stage?: "typed" | "submitted";
};

/** Persist + email a signup intent. Never throws. */
export async function captureSignupLead(lead: SignupLead): Promise<void> {
  const email = String(lead.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return;

  const company = String(lead.company || "").trim() || null;
  const plan = String(lead.plan || "").trim().toUpperCase() || null;
  const seats =
    typeof lead.seats === "number" && Number.isFinite(lead.seats)
      ? lead.seats
      : null;
  const stage = lead.stage === "submitted" ? "submitted" : "typed";

  await recordEvent({
    kind: "CONVERT",
    source: "MARKETING",
    path: "/signup",
    label: `signup_${stage}:${email}`,
    detail: { email, company, plan, seats, stage },
  });

  const apiKey = process.env.RESEND_API_KEY;
  const fromAddr =
    process.env.EMAIL_FROM || "Protessera <noreply@protessera.com>";
  if (!apiKey) {
    console.info("[lead] captured (no RESEND_API_KEY)", {
      email,
      company,
      plan,
      seats,
      stage,
    });
    return;
  }

  const subject =
    stage === "submitted"
      ? `Protessera signup submitted — ${email}`
      : `Protessera signup email typed — ${email}`;
  const body = [
    stage === "submitted"
      ? "They hit Continue to checkout."
      : "They typed a work email on /signup (may not have submitted yet).",
    "",
    `Email:   ${email}`,
    `Company: ${company || "(blank)"}`,
    `Plan:    ${plan || "(none)"}`,
    seats != null ? `Seats:   ${seats}` : null,
    "",
    "https://www.protessera.com/signup",
  ]
    .filter((l) => l !== null)
    .join("\n");

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [NOTIFY_TO],
        subject,
        text: body,
      }),
    });
    if (!resp.ok) {
      console.error(
        "[lead] Resend failed:",
        resp.status,
        (await resp.text()).slice(0, 300)
      );
    }
  } catch (err) {
    console.error("[lead] notify failed:", err instanceof Error ? err.message : err);
  }
}

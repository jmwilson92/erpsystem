import { NextRequest } from "next/server";
import { verifyWebhook, handleWebhookEvent } from "@/lib/services/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook receiver. Verifies the signature, then maps subscription
 * events onto the local plan state (activate / cancel). Point your Stripe
 * webhook endpoint at /api/stripe/webhook and set STRIPE_WEBHOOK_SECRET.
 */
export async function POST(req: NextRequest) {
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature");
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = verifyWebhook(payload, sig) as typeof event;
  } catch (err) {
    return new Response(
      `Webhook error: ${err instanceof Error ? err.message : "invalid"}`,
      { status: 400 }
    );
  }
  try {
    await handleWebhookEvent(event);
  } catch (err) {
    return new Response(
      `Handler error: ${err instanceof Error ? err.message : "failed"}`,
      { status: 500 }
    );
  }
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

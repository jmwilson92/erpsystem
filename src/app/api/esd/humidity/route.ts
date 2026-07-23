import { NextRequest, NextResponse } from "next/server";
import { recordHumidity } from "@/lib/services/inspections";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Humidity-device ingest for ESD tracking. A sensor posts relative humidity for
 * an area / workcenter and it lands in the ESD module.
 *
 *   POST /api/esd/humidity
 *   Authorization: Bearer <ESD_HUMIDITY_TOKEN>          (device auth)
 *   { "location": "WC-12", "workcenterId": "...", "relativeHumidity": 42.5,
 *     "temperatureC": 21.0, "deviceId": "sensor-3" }
 *
 * When ESD_HUMIDITY_TOKEN is set, the bearer token must match. Otherwise a
 * signed-in session is accepted (for manual testing) — set the token before
 * exposing the endpoint to a device.
 */
export async function POST(req: NextRequest) {
  const token = process.env.ESD_HUMIDITY_TOKEN;
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (token) {
    if (bearer !== token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Set ESD_HUMIDITY_TOKEN to enable device ingest, or call while signed in." },
        { status: 401 }
      );
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rh = Number(body.relativeHumidity ?? body.rh);
  const location = String(body.location ?? body.workcenter ?? "").trim();
  if (!location || !Number.isFinite(rh)) {
    return NextResponse.json({ error: "location and relativeHumidity are required" }, { status: 400 });
  }

  try {
    const reading = await recordHumidity({
      location,
      workcenterId: body.workcenterId ? String(body.workcenterId) : undefined,
      relativeHumidity: rh,
      temperatureC: body.temperatureC != null ? Number(body.temperatureC) : undefined,
      source: "DEVICE",
      deviceId: body.deviceId ? String(body.deviceId) : undefined,
    });
    return NextResponse.json({ ok: true, id: reading.id, recordedAt: reading.recordedAt });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 400 });
  }
}

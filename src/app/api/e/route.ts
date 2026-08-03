/**
 * Client event intake.
 *
 * Deliberately named `/api/e` rather than `/api/telemetry`. EasyPrivacy and
 * every list derived from it block request paths containing "telemetry",
 * "analytics" or "track" — so the old path was dropped before it left the
 * browser for any visitor running a content blocker. That silently cost us
 * page events AND client-side error reports, which is why a blank-page
 * incident produced no rows at all in TelemetryEvent.
 *
 * This is first-party, same-origin, and records only what the old route did.
 * `/api/telemetry` still forwards here so nothing that already points at it
 * breaks; new callers should use this path.
 */
export { POST, runtime, dynamic } from "../telemetry/route";

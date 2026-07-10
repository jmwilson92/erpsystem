import QRCode from "qrcode";

/**
 * Build the deep-link payload for a work order QR code.
 * Phase 2 mobile app will open this URL; for now it points at the web traveler.
 */
export function workOrderQrPayload(workOrderId: string, number: string, baseUrl?: string) {
  const origin =
    baseUrl ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000";
  const url = new URL(`/work-orders/${workOrderId}`, origin);
  url.searchParams.set("wo", number);
  url.searchParams.set("src", "qr");
  return url.toString();
}

/** Generate a QR code as a PNG data URL (for print / embed). */
export async function generateQrDataUrl(
  payload: string,
  opts?: { width?: number; margin?: number }
): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: opts?.margin ?? 2,
    width: opts?.width ?? 280,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
}

/** Generate QR as SVG string (sharp print). */
export async function generateQrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
}

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "ForgeRP — Manufacturing ERP for sales, production, quality, and accounting";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(145deg, #020617 0%, #0f172a 55%, #042f2e 100%)",
          padding: "64px 72px",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "linear-gradient(135deg, #2dd4bf 0%, #0891b2 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            F
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: "#f1f5f9",
              letterSpacing: "-0.02em",
            }}
          >
            ForgeRP
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
              color: "#f8fafc",
            }}
          >
            Manufacturing ERP that runs your whole shop
          </div>
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.35,
              color: "#94a3b8",
              maxWidth: 900,
            }}
          >
            Sales · engineering · production · quality · accounting — one
            connected system. Live in a day. 45-day free trial.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#64748b",
            fontSize: 22,
          }}
        >
          <span>AS9100-shaped · shop floor to cash · no consultants</span>
          <span style={{ color: "#2dd4bf", fontWeight: 600 }}>forge-rp.live</span>
        </div>
      </div>
    ),
    { ...size }
  );
}

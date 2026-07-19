"use client";

/**
 * Root-level error UI (replaces root layout when it crashes).
 * Keep styling self-contained — layout may not mount.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
          color: "#e2e8f0",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#fb7185",
              fontWeight: 600,
            }}
          >
            ForgeRP
          </p>
          <h1 style={{ fontSize: 20, margin: "12px 0" }}>
            Application error
          </h1>
          <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.5 }}>
            The shell failed to render. Reload the page. If this persists,
            check server logs and{" "}
            <code style={{ color: "#5eead4" }}>/api/health</code>.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                color: "#475569",
                marginTop: 12,
              }}
            >
              ref {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 20,
              padding: "8px 14px",
              borderRadius: 8,
              border: "none",
              background: "#0d9488",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}

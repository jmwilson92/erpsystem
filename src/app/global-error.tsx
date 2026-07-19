"use client";

/**
 * Root-layout error boundary. Rendered when the layout itself fails, so
 * it must ship its own <html>/<body> and inline styles (no app CSS).
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
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 420, padding: 32 }}>
          <p style={{ fontSize: 48, margin: 0 }}>🔧</p>
          <h1 style={{ fontSize: 20, margin: "16px 0 8px" }}>
            Something broke on our side
          </h1>
          <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.5 }}>
            The app hit an unexpected error. Your data is safe — reload the
            page, and if it keeps happening quote the reference below to
            support.
          </p>
          {error.digest && (
            <p style={{ fontFamily: "monospace", fontSize: 12, color: "#64748b" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              marginTop: 16,
              padding: "8px 20px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0ea5e9",
              color: "#fff",
              fontSize: 14,
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

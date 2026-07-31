import {
  HOLD_LABELS,
  STAGE_LABELS,
  portalDashboard,
  type HoldKind,
  type Stage,
} from "@/lib/services/customer-portal";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
}

const HOLD_TONE: Record<HoldKind, string> = {
  MATERIAL: "hold-material",
  QUALITY: "hold-quality",
  CREDIT: "hold-credit",
  NONE: "",
};

const STAGE_TONE: Record<Stage, string> = {
  ORDERED: "st-ordered",
  IN_PRODUCTION: "st-production",
  BUILT: "st-built",
  PARTIALLY_SHIPPED: "st-partial",
  SHIPPED: "st-shipped",
};

/**
 * Progress track. Two bars in one groove: built sits behind, shipped in front,
 * so the gap between "made" and "sent" is legible at a glance rather than
 * needing two separate widgets.
 *
 * Widths are driven by CSS custom properties and animated with a keyframe that
 * grows from zero, so the movement happens on paint with no client JavaScript.
 */
function Track({
  builtPct,
  shippedPct,
  delay = 0,
}: {
  builtPct: number;
  shippedPct: number;
  delay?: number;
}) {
  return (
    <div className="track" aria-hidden="true">
      <div
        className="fill fill-built"
        style={
          {
            "--target": `${builtPct}%`,
            animationDelay: `${delay}ms`,
          } as React.CSSProperties
        }
      />
      <div
        className="fill fill-shipped"
        style={
          {
            "--target": `${shippedPct}%`,
            animationDelay: `${delay + 120}ms`,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

/** Completion ring — stroke-dashoffset animated from empty to the value. */
function Ring({ pct, label }: { pct: number; label: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div className="ring-wrap">
      <svg width="128" height="128" viewBox="0 0 128 128" className="ring">
        <circle cx="64" cy="64" r={r} className="ring-bg" />
        <circle
          cx="64"
          cy="64"
          r={r}
          className="ring-fg"
          style={
            {
              strokeDasharray: c,
              "--offset": offset,
              "--circumference": c,
            } as React.CSSProperties
          }
        />
      </svg>
      <div className="ring-label">
        <span className="ring-pct">{Math.round(pct)}%</span>
        <span className="ring-caption">{label}</span>
      </div>
    </div>
  );
}

export default async function CustomerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await portalDashboard(token);

  if (!data) {
    return (
      <div className="cp-root">
        <div className="cp-shell" style={{ maxWidth: 520 }}>
          <div className="card">
            <h2 className="card-title">Link not valid</h2>
            <p className="muted">
              This portal link has expired or is no longer active. Please ask
              your contact for a fresh one.
            </p>
          </div>
        </div>
        <PortalStyles />
      </div>
    );
  }

  const { customer, orders, summary } = data;
  const open = orders.filter((o) => !o.isComplete);
  const overall =
    orders.length > 0
      ? orders.reduce((s, o) => s + o.shippedPct, 0) / orders.length
      : 0;

  return (
    <div className="cp-root">
      <div className="cp-shell">
        <header className="cp-head">
          <div>
            <p className="eyebrow">Order portal</p>
            <h1 className="cp-title">{customer.name}</h1>
          </div>
          <Ring pct={overall} label="delivered" />
        </header>

        <section className="stats">
          {[
            { label: "Open orders", value: summary.openOrders, tone: "" },
            { label: "Units outstanding", value: summary.unitsOpen, tone: "" },
            {
              label: "On hold",
              value: summary.onHold,
              tone: summary.onHold > 0 ? "warn" : "",
            },
            {
              label: "Past due",
              value: summary.late,
              tone: summary.late > 0 ? "bad" : "",
            },
          ].map((s, i) => (
            <div
              key={s.label}
              className={`card stat rise ${s.tone}`}
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <span className="stat-value">{s.value}</span>
              <span className="stat-label">{s.label}</span>
            </div>
          ))}
        </section>

        {open.length === 0 && (
          <div className="card rise">
            <h2 className="card-title">Nothing outstanding</h2>
            <p className="muted">
              Every order on file has shipped in full. Completed orders remain
              listed below.
            </p>
          </div>
        )}

        <section className="orders">
          {orders.map((o, oi) => (
            <article
              key={o.id}
              className="card order rise"
              style={{ animationDelay: `${140 + oi * 90}ms` }}
            >
              <div className="order-head">
                <div>
                  <h2 className="order-number">{o.number}</h2>
                  <p className="muted small">
                    {o.customerPo ? `Your PO ${o.customerPo} · ` : ""}
                    Ordered {fmtDate(o.orderDate)} · Due {fmtDate(o.requiredDate)}
                  </p>
                </div>
                <div className="badges">
                  {o.hold !== "NONE" && (
                    <span className={`badge ${HOLD_TONE[o.hold]} pulse`}>
                      {HOLD_LABELS[o.hold]}
                    </span>
                  )}
                  {o.lateDays != null && o.lateDays > 0 && (
                    <span className="badge bad">
                      {o.lateDays} day{o.lateDays === 1 ? "" : "s"} past due
                    </span>
                  )}
                  {o.isComplete && <span className="badge good">Complete</span>}
                </div>
              </div>

              <div className="order-progress">
                <Track
                  builtPct={o.builtPct}
                  shippedPct={o.shippedPct}
                  delay={200 + oi * 90}
                />
                <div className="legend">
                  <span>
                    <i className="dot dot-built" /> Built {Math.round(o.builtPct)}%
                  </span>
                  <span>
                    <i className="dot dot-shipped" /> Shipped{" "}
                    {Math.round(o.shippedPct)}%
                  </span>
                </div>
              </div>

              <ul className="lines">
                {o.lines.map((l, li) => (
                  <li
                    key={l.id}
                    className="line rise"
                    style={{ animationDelay: `${260 + oi * 90 + li * 40}ms` }}
                  >
                    <div className="line-head">
                      <div className="line-id">
                        <span className="line-no">{l.lineNumber}</span>
                        <span className="line-part">
                          {l.partNumber || l.description}
                        </span>
                      </div>
                      <span className={`stage ${STAGE_TONE[l.stage]}`}>
                        {STAGE_LABELS[l.stage]}
                      </span>
                    </div>

                    {l.partNumber && (
                      <p className="muted small line-desc">{l.description}</p>
                    )}

                    <Track
                      builtPct={l.builtPct}
                      shippedPct={l.shippedPct}
                      delay={300 + oi * 90 + li * 40}
                    />

                    <div className="line-foot">
                      <span>
                        {l.quantityShipped} of {l.quantity} shipped
                      </span>
                      {l.quantityBuilt > l.quantityShipped && (
                        <span className="muted">
                          {l.quantityBuilt - l.quantityShipped} built, awaiting
                          shipment
                        </span>
                      )}
                      {l.hold !== "NONE" && (
                        <span className={`badge small ${HOLD_TONE[l.hold]}`}>
                          {HOLD_LABELS[l.hold]}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <footer className="cp-foot muted small">
          Progress is measured in units, not elapsed time. Built shows what has
          been completed in production; shipped shows what has left the building.
        </footer>
      </div>
      <PortalStyles />
    </div>
  );
}

/**
 * Styles are inline and scoped to this page rather than pulled from the app
 * shell: the portal is seen by a customer, not an operator, and it should not
 * inherit whatever the internal theme does next.
 */
function PortalStyles() {
  return (
    <style>{`
.cp-root {
  min-height: 100vh;
  background:
    radial-gradient(1100px 500px at 15% -10%, rgba(56,189,248,0.10), transparent 60%),
    radial-gradient(900px 450px at 105% 0%, rgba(16,185,129,0.08), transparent 55%),
    #060911;
  color: #e2e8f0;
  padding: 32px 20px 64px;
  font-feature-settings: "tnum" 1;
}
.cp-shell { max-width: 940px; margin: 0 auto; }
.cp-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 24px; flex-wrap: wrap; margin-bottom: 28px;
}
.eyebrow {
  text-transform: uppercase; letter-spacing: .16em; font-size: 11px;
  color: #64748b; margin: 0 0 6px;
}
.cp-title { font-size: 30px; font-weight: 650; margin: 0; letter-spacing: -.02em; }
.muted { color: #94a3b8; }
.small { font-size: 12px; }

.card {
  background: rgba(15,23,42,.72);
  border: 1px solid rgba(51,65,85,.7);
  border-radius: 14px;
  padding: 18px 20px;
  backdrop-filter: blur(6px);
}
.card-title { font-size: 16px; font-weight: 600; margin: 0 0 6px; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
@media (max-width: 640px) { .stats { grid-template-columns: repeat(2, 1fr); } }
.stat { display: flex; flex-direction: column; gap: 4px; }
.stat-value { font-size: 28px; font-weight: 650; letter-spacing: -.02em; }
.stat-label { font-size: 12px; color: #94a3b8; }
.stat.warn .stat-value { color: #fbbf24; }
.stat.bad .stat-value { color: #fb7185; }

.orders { display: flex; flex-direction: column; gap: 16px; }
.order-head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.order-number { font-size: 18px; font-weight: 620; margin: 0 0 4px; font-variant-numeric: tabular-nums; }
.badges { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start; }

.badge {
  font-size: 11px; padding: 3px 9px; border-radius: 999px;
  border: 1px solid currentColor; white-space: nowrap;
}
.badge.small { font-size: 10px; padding: 2px 7px; }
.badge.good { color: #34d399; }
.badge.bad { color: #fb7185; }
.hold-material { color: #fbbf24; }
.hold-quality { color: #f472b6; }
.hold-credit { color: #f59e0b; }

.order-progress { margin: 16px 0 8px; }
.track {
  position: relative; height: 10px; border-radius: 999px;
  background: rgba(30,41,59,.9); overflow: hidden;
}
.fill {
  position: absolute; inset: 0 auto 0 0; width: 0;
  border-radius: 999px;
  animation: grow .9s cubic-bezier(.22,.8,.28,1) forwards;
}
.fill-built { background: linear-gradient(90deg, rgba(56,189,248,.35), rgba(56,189,248,.55)); }
.fill-shipped { background: linear-gradient(90deg, #22d3ee, #34d399); }
@keyframes grow { from { width: 0; } to { width: var(--target); } }

.legend { display: flex; gap: 16px; margin-top: 8px; font-size: 12px; color: #94a3b8; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; margin-right: 6px; }
.dot-built { background: rgba(56,189,248,.55); }
.dot-shipped { background: #34d399; }

.lines { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.line { border-top: 1px solid rgba(51,65,85,.6); padding-top: 12px; }
.line-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.line-id { display: flex; align-items: baseline; gap: 10px; }
.line-no {
  font-size: 11px; color: #64748b; border: 1px solid rgba(71,85,105,.8);
  border-radius: 6px; padding: 1px 6px;
}
.line-part { font-weight: 560; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.line-desc { margin: 4px 0 8px; }
.line-foot { display: flex; gap: 14px; margin-top: 8px; font-size: 12px; color: #cbd5e1; flex-wrap: wrap; align-items: center; }

.stage { font-size: 11px; padding: 3px 10px; border-radius: 999px; background: rgba(30,41,59,.9); color: #94a3b8; }
.st-production { color: #38bdf8; }
.st-built { color: #a78bfa; }
.st-partial { color: #22d3ee; }
.st-shipped { color: #34d399; }

.ring-wrap { position: relative; width: 128px; height: 128px; flex: none; }
.ring { transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: rgba(30,41,59,.9); stroke-width: 10; }
.ring-fg {
  fill: none; stroke: url(#g); stroke-width: 10; stroke-linecap: round;
  stroke: #34d399;
  stroke-dashoffset: var(--circumference);
  animation: sweep 1.1s cubic-bezier(.22,.8,.28,1) .15s forwards;
}
@keyframes sweep { to { stroke-dashoffset: var(--offset); } }
.ring-label {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px;
}
.ring-pct { font-size: 24px; font-weight: 650; letter-spacing: -.02em; }
.ring-caption { font-size: 10px; text-transform: uppercase; letter-spacing: .14em; color: #64748b; }

.rise { opacity: 0; animation: rise .55s cubic-bezier(.22,.8,.28,1) forwards; }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

.pulse { animation: pulse 2.4s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }

.cp-foot { margin-top: 28px; text-align: center; }

/* Motion is decoration here — the numbers are already on the page, so a
   viewer who asks for less of it simply gets the final state immediately. */
@media (prefers-reduced-motion: reduce) {
  .fill { animation: none; width: var(--target); }
  .ring-fg { animation: none; stroke-dashoffset: var(--offset); }
  .rise { opacity: 1; animation: none; }
  .pulse { animation: none; }
}
`}</style>
  );
}

/**
 * Render canary.
 *
 * The page is fully server-rendered, so the HTML always contains the content.
 * A visitor can still end up staring at an empty background: an extension that
 * rewrites page CSS, an aggressive cosmetic filter, or a stylesheet that fails
 * to apply can collapse or hide everything while the document itself is fine.
 * They see nothing, we hear nothing, and they leave.
 *
 * This checks, after load, whether anything actually has height on screen. If
 * not it reveals a plain fallback and reports the fact, so a blanked visitor
 * still gets somewhere to click and we find out it happened.
 *
 * Constraints that shape the implementation:
 *
 *   - It is an INLINE script. If the main bundle is what got blocked, anything
 *     depending on it is already gone.
 *   - The fallback's styles are applied with priority "important" from JS.
 *     Extension stylesheets use !important, and a plain style attribute loses
 *     to that — so the fallback would be hidden by the same rule that hid the
 *     page.
 *   - Ids and class names are neutral. Calling it "banner" or "promo" would
 *     invite the very filters this exists to survive.
 *   - It reports to /api/e, never /api/telemetry, which blockers drop.
 */
export function RenderCanary() {
  const js = `
(function () {
  var REPORTED = false;
  function report(reason) {
    if (REPORTED) return;
    REPORTED = true;
    try {
      fetch("/api/e", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "ERROR",
          path: location.pathname,
          label: "blank render recovered: " + reason,
          severity: "error",
          detail: { ua: navigator.userAgent, boundary: "canary" }
        }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  /**
   * Hidden by anything in the chain from this element up to <html>.
   *
   * Height alone is not enough: visibility:hidden and opacity:0 leave the box
   * exactly the size it was, so a page blanked that way measures as perfectly
   * healthy while showing nothing.
   */
  function hiddenByChain(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      var cs = window.getComputedStyle(node);
      if (
        cs.display === "none" ||
        cs.visibility === "hidden" ||
        cs.visibility === "collapse" ||
        parseFloat(cs.opacity) === 0
      ) {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  function isBlank() {
    var main = document.querySelector("main") || document.body;
    if (!main) return true;
    if (hiddenByChain(main)) return true;
    return main.getBoundingClientRect().height < 40;
  }

  function force(node, display) {
    var s = node.style;
    if (display) s.setProperty("display", display, "important");
    s.setProperty("visibility", "visible", "important");
    s.setProperty("opacity", "1", "important");
    s.setProperty("height", "auto", "important");
    s.setProperty("max-height", "none", "important");
    s.setProperty("overflow", "visible", "important");
  }

  function reveal(reason) {
    var el = document.getElementById("fallback-content");
    if (!el) return;

    // Un-hide the fallback itself, beating the !important rules an injected
    // stylesheet uses.
    force(el, "block");
    el.removeAttribute("hidden");

    // Then walk up to <html>. Forcing only the fallback is not enough: a rule
    // like "body > * { display: none !important }" hides its ANCESTORS, and a
    // visible element inside a hidden parent is still invisible. Each ancestor
    // is only overridden when it is actually hidden, so a healthy page is
    // never restyled.
    var node = el.parentNode;
    while (node && node.nodeType === 1) {
      var cs = window.getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") {
        force(node, cs.display === "none" ? "block" : "");
      }
      node = node.parentNode;
    }

    report(reason);
  }

  function check() {
    try {
      if (isBlank()) reveal("main not visible");
    } catch (e) {
      reveal("canary threw");
    }
  }

  // After load, then once more — some extensions inject their CSS late.
  if (document.readyState === "complete") setTimeout(check, 600);
  else window.addEventListener("load", function () { setTimeout(check, 600); });
  setTimeout(check, 2500);
})();
`;
  return (
    <>
      {/*
        Server-rendered but hidden. It has to already be in the document: if the
        stylesheet or the bundle is what broke, nothing can be fetched to build
        it later. Inline styles only — a class could be targeted by the same
        filter that hid the page.
      */}
      <div
        id="fallback-content"
        hidden
        style={{
          display: "none",
          padding: "40px 20px",
          maxWidth: "640px",
          margin: "0 auto",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          color: "#e2e8f0",
          lineHeight: 1.6,
        }}
      >
        <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "12px" }}>
          Protessera
        </h1>
        <p style={{ marginBottom: "20px", color: "#94a3b8" }}>
          Something in this browser is preventing the page from displaying —
          usually an extension that restyles or filters pages. The site itself
          is working. These links go straight through:
        </p>
        <p style={{ marginBottom: "10px" }}>
          <a href="/demo" style={{ color: "#2dd4bf", fontSize: "18px" }}>
            Start the live demo
          </a>
        </p>
        <p style={{ marginBottom: "10px" }}>
          <a href="/welcome" style={{ color: "#2dd4bf", fontSize: "18px" }}>
            What Protessera does
          </a>
        </p>
        <p style={{ marginBottom: "20px" }}>
          <a href="/login" style={{ color: "#2dd4bf", fontSize: "18px" }}>
            Sign in
          </a>
        </p>
        <p style={{ fontSize: "13px", color: "#64748b" }}>
          Opening this page in a private window, or pausing extensions for this
          site, restores the full experience.
        </p>
      </div>
      <script dangerouslySetInnerHTML={{ __html: js }} />
    </>
  );
}

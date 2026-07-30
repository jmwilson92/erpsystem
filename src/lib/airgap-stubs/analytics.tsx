/**
 * No-op replacement for @vercel/analytics in air-gapped builds.
 *
 * next.config.ts aliases the real package to this file when AIRGAP=1, so the
 * analytics collector's URL never reaches the client bundle at all. Gating the
 * JSX was not enough: the import alone shipped va.vercel-scripts.com into a
 * shared chunk, which made "this build cannot call out" untrue even though the
 * component never rendered. scripts/assert-airgap-build.mjs is what caught that.
 */
export function Analytics() {
  return null;
}

export default Analytics;

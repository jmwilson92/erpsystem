import { code39Bars } from "@/lib/barcode";

/**
 * Renders a Code 39 barcode as inline SVG (no client JS, prints
 * crisply). Bars only — render the human-readable value yourself so
 * text stays undistorted regardless of barcode width.
 */
export function Barcode({
  value,
  width = 220,
  height = 44,
}: {
  value: string;
  width?: number;
  height?: number;
}) {
  const { bars, totalWidth } = code39Bars(value);
  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Barcode ${value}`}
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={totalWidth} height={height} fill="#ffffff" />
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.width} height={height} fill="#000000" />
      ))}
    </svg>
  );
}

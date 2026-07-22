/**
 * Minimal AutoCAD R12 DXF writer — enough to drop a tool's ID (and optional
 * second line) onto a laser etcher. R12 ASCII is the most widely accepted
 * interchange format; a single TEXT entity per line keeps it importable
 * everywhere without needing font outlines.
 */

type DxfLine = { text: string; x: number; y: number; height: number };

function textEntity({ text, x, y, height }: DxfLine): string {
  return [
    "0", "TEXT",
    "8", "0", // layer 0
    "10", x.toFixed(3), // insertion X
    "20", y.toFixed(3), // insertion Y
    "30", "0.0",
    "40", height.toFixed(3), // text height
    "1", text, // the string
    "7", "STANDARD", // text style
  ].join("\n");
}

/**
 * Build a DXF label for a tool. `id` is etched large; `name` (optional) sits
 * below it smaller. Dimensions are in millimetres.
 */
export function toolLabelDxf(id: string, name?: string): string {
  const lines: DxfLine[] = [{ text: id, x: 0, y: name ? 4 : 0, height: 5 }];
  if (name?.trim()) {
    lines.push({ text: name.trim().slice(0, 40), x: 0, y: 0, height: 2.5 });
  }
  return [
    "0", "SECTION",
    "2", "HEADER",
    "9", "$ACADVER",
    "1", "AC1009",
    "0", "ENDSEC",
    "0", "SECTION",
    "2", "ENTITIES",
    ...lines.map(textEntity).join("\n").split("\n"),
    "0", "ENDSEC",
    "0", "EOF",
    "",
  ].join("\n");
}

/**
 * Code 39 barcode generation — pure data, no dependencies. Code 39 is
 * self-checking and reads on any commodity scanner, which is why it's
 * still the shop-floor standard for part/WO/bin labels.
 *
 * Each character is 9 elements (5 bars + 4 spaces, alternating,
 * starting with a bar); 3 of the 9 are wide. Characters are separated
 * by a narrow space. Text is wrapped in '*' start/stop characters.
 */

const PATTERNS: Record<string, string> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  "*": "nwnnwnwnn",
};

export type BarcodeBar = { x: number; width: number };

const NARROW = 1;
const WIDE = 2.5;

/**
 * Encode text as Code 39 bars. Unsupported characters are replaced
 * with '-'. Returns bar rectangles (in narrow-module units) plus the
 * total width so callers can scale.
 */
export function code39Bars(text: string): {
  bars: BarcodeBar[];
  totalWidth: number;
  encoded: string;
} {
  const cleaned = text
    .toUpperCase()
    .split("")
    .map((c) => (PATTERNS[c] && c !== "*" ? c : PATTERNS[c] === undefined ? "-" : c))
    .join("");
  const full = `*${cleaned.replace(/\*/g, "-")}*`;

  const bars: BarcodeBar[] = [];
  let x = 0;
  for (let ci = 0; ci < full.length; ci++) {
    const pattern = PATTERNS[full[ci]] || PATTERNS["-"];
    for (let i = 0; i < 9; i++) {
      const width = pattern[i] === "w" ? WIDE : NARROW;
      if (i % 2 === 0) bars.push({ x, width }); // even indices are bars
      x += width;
    }
    x += NARROW; // inter-character gap
  }
  return { bars, totalWidth: x - NARROW, encoded: full };
}

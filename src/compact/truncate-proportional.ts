// ── Wave 2 · fallback · truncate proportional (no LLM) ─────────────
//
// Gemini `truncation.ts:truncateProportionally` analogue. Used as
// the safety net when Layer 3 (Wave 4 LLM summarize) fails or is
// disabled — guarantees at least *some* size reduction so the next
// turn can land. Pure char operation: keep `headRatio` from the
// front and `tailRatio` from the end, drop the middle, splice in
// `[…truncated N chars…]` marker.

export interface TruncateProportionalOpts {
  /** Target string. */
  text: string;
  /** Cap on resulting string length (chars). */
  maxChars: number;
  /** Fraction of `maxChars` allocated to the head section. Default
   *  0.2 (Gemini's "head 20% / tail 80%"). */
  headRatio?: number;
}

export function truncateProportional(opts: TruncateProportionalOpts): string {
  const text = opts.text;
  const maxChars = Math.max(0, Math.floor(opts.maxChars));
  if (text.length <= maxChars || maxChars === 0) return text.slice(0, maxChars);
  const headRatio = clamp01(opts.headRatio ?? 0.2);
  const marker = (n: number): string => `\n…[truncated ${n} chars]…\n`;
  // Reserve marker length within budget.
  const sampleMarkerLen = marker(text.length).length;
  const usable = Math.max(0, maxChars - sampleMarkerLen);
  if (usable <= 0) return text.slice(0, maxChars);
  const headLen = Math.floor(usable * headRatio);
  const tailLen = usable - headLen;
  const head = text.slice(0, headLen);
  const tail = text.slice(text.length - tailLen);
  const removed = text.length - (headLen + tailLen);
  return `${head}${marker(removed)}${tail}`;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.2;
  return Math.max(0, Math.min(1, n));
}

// ── Binary file / buffer detection ──
//
// Ported from claude-code-fork and codex's heuristic: sample the first
// N bytes, count NUL bytes and non-printable ratio, declare binary
// above a threshold. This lets consumers (Read preview highlight,
// diff render) skip expensive syntax-highlight work on binary files
// — and more importantly avoid emitting garbage into the tool_result
// preview when the "file" is actually an image, ELF binary, etc.
//
// Design:
//   • We sample — not read the full file. 8 KiB is plenty to catch
//     NUL-heavy formats.
//   • Count BOTH "NUL bytes present at all" (hard signal) and
//     "printable ratio" (soft signal). Any NUL in the first 8 KiB →
//     binary. Otherwise, <95% printable also → binary.
//   • Accept `string` (already-read content) or `Uint8Array` (raw
//     buffer). The string path assumes already-UTF-8-decoded text;
//     NULs in strings are rare but possible.

const SAMPLE_BYTES = 8192;
const PRINTABLE_RATIO_THRESHOLD = 0.95;

export interface BinaryDetectionResult {
  binary: boolean;
  /** Shortcut reason for debug / diagnostics. */
  reason:
    | 'empty'
    | 'nul-byte'
    | 'low-printable-ratio'
    | 'appears-text';
  /** Fraction of bytes sampled that were printable (space, tab, LF,
   *  or 0x20–0x7E). Useful for explaining borderline decisions. */
  printableRatio: number;
}

/** Classify the content at the given path/buffer as binary-or-text.
 *  Never throws — falls back to `{ binary: false, reason: 'empty' }`
 *  on an empty input. */
export function detectBinary(input: string | Uint8Array): BinaryDetectionResult {
  const bytes = typeof input === 'string'
    ? utf8SampleBytes(input, SAMPLE_BYTES)
    : input.subarray(0, Math.min(input.length, SAMPLE_BYTES));

  if (bytes.length === 0) {
    return { binary: false, reason: 'empty', printableRatio: 1 };
  }

  let printable = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0) {
      // NUL byte — hard signal for binary.
      return { binary: true, reason: 'nul-byte', printableRatio: printable / (i + 1) };
    }
    // Printable ASCII + common whitespace. UTF-8 continuation bytes
    // (>= 0x80) also count as printable for our purposes; a truly
    // binary format tends to have NULs long before we'd need to guess
    // at multi-byte sequences.
    if (
      b === 0x09        // tab
      || b === 0x0a     // LF
      || b === 0x0d     // CR
      || (b >= 0x20 && b <= 0x7e)
      || b >= 0x80
    ) printable++;
  }

  const ratio = printable / bytes.length;
  if (ratio < PRINTABLE_RATIO_THRESHOLD) {
    return { binary: true, reason: 'low-printable-ratio', printableRatio: ratio };
  }
  return { binary: false, reason: 'appears-text', printableRatio: ratio };
}

/** Encode the first `maxBytes` of a UTF-8 string into a byte sample.
 *  Avoids allocating the entire buffer for the whole file. */
function utf8SampleBytes(s: string, maxBytes: number): Uint8Array {
  const enc = new TextEncoder();
  // Encode a slice first to avoid worst-case O(n) allocation on huge
  // strings. UTF-8 max byte per code unit is 4, so a character slice
  // of `maxBytes` chars is guaranteed to cover `maxBytes` bytes.
  const slice = s.length <= maxBytes ? s : s.slice(0, maxBytes);
  const full = enc.encode(slice);
  return full.subarray(0, Math.min(full.length, maxBytes));
}

// PLAN §4.5 · Arc 2.1 — Sub-agent resume seed.
//
// A sub-agent's tool_result is a single string (its final assistant
// turn). Without help, the parent LLM has to re-read the sub-agent's
// summary to figure out which file/test it identified — burning a
// turn on inspect work the child already finished. The seed module
// extracts a `LoopSignalSnapshot`-shaped digest from the child's
// final text and appends it as a structured `<subagent-signal>`
// block to the tool_result. The parent then sees the same signals
// the child found, in canonical positions, without needing to scan.
//
// Design constraint: this module is heuristic, not authoritative.
// If the child's text doesn't contain any recognisable signal, we
// pass through unchanged — never invent fields.

/** Reuses the loop-state shape that turn-checkpoint already serialises
 *  so consumers (e.g. ExecutionLoopState.lastSignal) can merge directly. */
export interface SubAgentSignal {
  /** First `src/...` file referenced — the child's likely "primary
   *  source under investigation". */
  primarySourceFile: string | null;
  /** First `test/...` (or `tests/...`) file — the child's likely
   *  "primary test under investigation". */
  primaryTestFile: string | null;
  /** Up to 3 lines that look like errors / assertions. Each capped
   *  to 120 chars. */
  stackPreview: string[];
  /** Single most-promising "interesting line" — usually the first
   *  assertion failure or thrown error. */
  interestingLine: string | null;
}

const SOURCE_FILE_RE = /(?:^|[\s\(\[`'"])(src\/[A-Za-z0-9_\-./]+\.(?:ts|tsx|js|jsx|mjs|cjs|md))(?::\d+(?::\d+)?)?/g;
const TEST_FILE_RE = /(?:^|[\s\(\[`'"])((?:test|tests|__tests__)\/[A-Za-z0-9_\-./]+\.(?:test|spec)\.[a-z]+)(?::\d+(?::\d+)?)?/g;
const STACK_LINE_RE = /^\s*(?:at\s|expected\s|Error:\s|TypeError:\s|ReferenceError:\s|SyntaxError:\s|AssertionError:\s|FAIL\s|✗\s|×\s)/i;
const ASSERTION_RE = /^\s*expected\s/i;

function firstMatch(text: string, re: RegExp): string | null {
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    if (m[1]) return m[1];
  }
  return null;
}

function collectStackLines(text: string, limit = 3): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (STACK_LINE_RE.test(line)) {
      out.push(line.length > 120 ? line.slice(0, 117) + '…' : line);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function pickInterestingLine(stack: string[]): string | null {
  // Prefer assertion-style lines ("expected X but got Y") because
  // they encode the actual gap, not the call site.
  for (const line of stack) if (ASSERTION_RE.test(line)) return line;
  return stack[0] ?? null;
}

/** Heuristic extractor — returns null when the text contains no
 *  recognisable file/path/error signal. */
export function extractSubAgentSignal(text: string): SubAgentSignal | null {
  if (!text || typeof text !== 'string') return null;
  const primarySourceFile = firstMatch(text, SOURCE_FILE_RE);
  const primaryTestFile = firstMatch(text, TEST_FILE_RE);
  const stackPreview = collectStackLines(text);
  const interestingLine = pickInterestingLine(stackPreview);
  if (!primarySourceFile && !primaryTestFile && stackPreview.length === 0) {
    return null;
  }
  return {
    primarySourceFile,
    primaryTestFile,
    stackPreview,
    interestingLine,
  };
}

/** Render a signal as a copy-pasteable block. The XML-ish wrapper
 *  is intentional: it's distinct enough that the parent LLM
 *  recognises the structure, and easy to grep for in transcripts. */
export function formatSubAgentSeed(signal: SubAgentSignal): string {
  const lines: string[] = [];
  lines.push('<subagent-signal>');
  if (signal.primarySourceFile) lines.push(`  primarySourceFile: ${signal.primarySourceFile}`);
  if (signal.primaryTestFile) lines.push(`  primaryTestFile: ${signal.primaryTestFile}`);
  if (signal.interestingLine) lines.push(`  interestingLine: ${signal.interestingLine}`);
  if (signal.stackPreview.length > 0) {
    lines.push('  stackPreview:');
    for (const s of signal.stackPreview) lines.push(`    - ${s}`);
  }
  lines.push('</subagent-signal>');
  return lines.join('\n');
}

/** Wrap a sub-agent's final text with a structured signal block when
 *  the heuristic extractor finds one. Pass-through otherwise — never
 *  appends an empty signal. The parent's tool_result content carries
 *  the signal automatically; no separate plumbing through the LLM
 *  loop is required. */
export function enhanceAgentResultWithSeed(text: string): string {
  const signal = extractSubAgentSignal(text);
  if (!signal) return text;
  const seed = formatSubAgentSeed(signal);
  // Single blank line separator so the seed is visually distinct
  // without introducing an extra paragraph break the model has to
  // skip past.
  return text.endsWith('\n') ? `${text}\n${seed}` : `${text}\n\n${seed}`;
}

const EXCLUDED_LINE_PREFIXES = [
  '경계:',
  'Boundary decision:',
  'UNVERIFIABLE:',
  '출처:',
  'Command help probe:',
  'Scope-boundary candidates',
  'If adopted, state each boundary',
] as const;

/** Earlier English metadata labels (case-insensitive) kept from the first landed piece. */
const EXCLUDED_ENGLISH_SCOPE_LINE = /^(?:excluded boundary|boundary decision|decision|diagnostic)\s*:/i;

function normalizedLine(line: string): string {
  let normalized = line;
  let previous: string;
  do {
    previous = normalized;
    normalized = normalized.replace(/^\s*(?:(?:[-*+]\s+)|(?:>\s*))/, '');
  } while (normalized !== previous);
  return normalized;
}

function isLevelTwoHeading(line: string): boolean {
  return /^## (?!#)/.test(normalizedLine(line));
}

function isExcludedLine(line: string): boolean {
  const normalized = normalizedLine(line);
  return EXCLUDED_LINE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || EXCLUDED_ENGLISH_SCOPE_LINE.test(normalized)
    || /^(?:⭐|⛔|⏸️) 결정 \d+:/.test(normalized);
}

/** Removes goal-document metadata lines (boundary, diagnostic, source, guidance, SCOPE BOUNDARY section)
 *  that must not become implementation path candidates. Retained lines keep their own line endings. */
export function targetScopedGoalText(text: string): string {
  const lines = text.matchAll(/.*(?:\r\n|\n|\r|$)/g);
  let result = '';
  let inScopeBoundary = false;

  for (const match of lines) {
    const unit = match[0];
    if (!unit) continue;
    const line = unit.replace(/\r\n|\n|\r$/, '');
    const normalized = normalizedLine(line);
    if (/^## SCOPE BOUNDARY\s*$/.test(normalized)) {
      inScopeBoundary = true;
      continue;
    }
    if (inScopeBoundary) {
      if (isLevelTwoHeading(line)) inScopeBoundary = false;
      else continue;
    }
    if (!isExcludedLine(line)) result += unit;
  }

  return result;
}

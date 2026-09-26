// ── B4 (TUI half) — the design-check verdict as renderable lines ──
//
// The PWA half projects the same verdict into rows + badges. A terminal has no
// badges, so the projection differs — but the RULE must not. Both surfaces sort
// by severity before name, and both distinguish "shipped but not declared" from
// "declared and present", because those answer different questions.
//
// Kept free of TUI imports so the interesting part — what is shown, in what
// order, with what tone — is testable without a terminal. The slash handler
// does nothing but map `tone` onto its colour functions and push.

import type { DesignCheckOutcome } from './design-check.js';

/** Semantic tone. The caller maps these onto its own palette; naming them by
 *  MEANING rather than colour keeps the renderer honest across themes (and
 *  keeps a theme swap from silently turning "missing" green). */
export type DesignCheckTone = 'heading' | 'ok' | 'bad' | 'muted' | 'plain';

export interface DesignCheckLine {
  text: string;
  tone: DesignCheckTone;
}

export interface DesignCheckRenderOptions {
  /** B5 — 이 문서가 선언한 시각 방향과 고를 수 있는 것들.
   *  ⛔ 렌더러가 «스스로» 방향을 도출하지 않는다. 그러면 이 파일이
   *  `THEME_REGISTRY` 의 두 번째 독자가 되고, 호출자마다 다른 시점의
   *  목록을 볼 수 있다. 호출자가 «한 번» 도출해 넘긴다. */
  directions?: {
    declared: string | null;
    unavailable: string | null;
    available: ReadonlyArray<{ id: string; mood: string }>;
  };
  /** When false, rulebooks that elanous ships but the document does not declare
   *  are omitted. The default shows them: "what could I turn on?" is the
   *  question a terminal user is usually asking, and the CLI's own
   *  `repo design-check` cannot answer it. */
  includeUndeclared?: boolean;
}

/** Human sentence for a blocked verdict — keyed off the discriminant, never
 *  parsed out of prose, so a new reason is a compile error rather than a
 *  silently generic line. Mirrors the PWA's `describeBlocked`. */
function blockedLines(outcome: Extract<DesignCheckOutcome, { ok: false }>): DesignCheckLine[] {
  const detail = outcome.blockedOn === 'craft-directory'
    ? `elanous's craft rulebook directory could not be read: ${outcome.path}`
    : `no readable DESIGN.md at: ${outcome.path}`;
  return [
    { text: 'Design check blocked', tone: 'bad' },
    { text: `  ${detail}`, tone: 'muted' },
  ];
}

/** Builds the terminal rendering of one verdict. */
export function renderDesignCheckLines(
  outcome: DesignCheckOutcome,
  options: DesignCheckRenderOptions = {},
): DesignCheckLine[] {
  if (!outcome.ok) return blockedLines(outcome);

  const missing = new Set(outcome.unavailableRulebooks);
  const declared = outcome.declaredRulebooks;
  const undeclared = options.includeUndeclared === false
    ? []
    : outcome.availableRulebooks.filter((name) => !declared.includes(name));

  const lines: DesignCheckLine[] = [
    { text: `Craft rulebooks — ${outcome.documentPath}`, tone: 'heading' },
  ];

  if (declared.length === 0) {
    lines.push({ text: '  (this document declares no craft rulebooks)', tone: 'muted' });
  }

  // ⛔ Missing first, then present — severity beats alphabetical order. In a
  //    terminal the list scrolls, so a missing entry buried mid-list is a
  //    missing entry nobody reads.
  for (const name of [...declared].sort((a, b) => {
    const rank = (n: string) => (missing.has(n) ? 0 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
  })) {
    lines.push(missing.has(name)
      ? { text: `  ✗ ${name}  (declared, not found)`, tone: 'bad' }
      : { text: `  ✓ ${name}`, tone: 'ok' });
  }

  for (const name of [...undeclared].sort((a, b) => a.localeCompare(b))) {
    lines.push({ text: `  · ${name}  (available, not declared)`, tone: 'muted' });
  }

  // The summary goes LAST, not first: in a scrolling terminal the final line
  // is the one still on screen after the list prints.
  lines.push(missing.size
    ? { text: `${missing.size} declared rulebook(s) could not be found.`, tone: 'bad' }
    : { text: `All ${declared.length} declared rulebook(s) resolve.`, tone: 'ok' });

  // ── B5 — 시각 방향 ──────────────────────────────────────────────────
  // 규칙집 «아래»에 둔다. 규칙집은 계약(못 찾으면 exit 1)이고 방향은 선택이라,
  // 둘을 섞으면 「선언 안 함」이 실패처럼 읽힌다.
  const dirs = options.directions;
  if (dirs) {
    lines.push({ text: '', tone: 'plain' });
    lines.push({ text: 'Design direction', tone: 'heading' });
    if (dirs.unavailable) {
      // 선언은 있는데 못 찾겠다 — 이것만 나쁜 상태다.
      lines.push({ text: `  ✗ ${dirs.unavailable}  (declared, not registered)`, tone: 'bad' });
    }
    if (dirs.declared === null) {
      // ⛔ 실패가 아니다. 방향을 아직 안 고른 프로젝트가 깨진 프로젝트는 아니다.
      lines.push({ text: '  (none declared — pick one below)', tone: 'muted' });
    }
    for (const d of dirs.available) {
      lines.push(d.id === dirs.declared
        ? { text: `  ✓ ${d.id}  ${d.mood}`, tone: 'ok' }
        : { text: `  · ${d.id}  ${d.mood}`, tone: 'muted' });
    }
  }

  return lines;
}

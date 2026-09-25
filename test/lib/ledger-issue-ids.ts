const definitionHeading = /^#{2,3}[ \t]+`?([A-Z]+-[A-Z0-9]+)`?(.*)$/gm;
const continuationMarker = /^\s*(?:(?:[·—-]\s*)?(?:이어짐|정정|닫힘)(?=\s|[·—-]|$)|\*\*(?:이어짐|정정|닫힘)(?:\*\*)?|\(원문\)|[①②③④⑤⑥⑦⑧⑨⑩⓵⓶⓷⓸⓹⓺⓻⓼⓽⓾])/u;

export const expectedDuplicateLedgerDefinitionCounts: Record<string, number> = {
  'COORD-T1': 2, 'GIT-S1': 3, 'GIT-S10': 3, 'GIT-S11': 2, 'GIT-S12': 2, 'GIT-S2': 2, 'GIT-S3': 2, 'GIT-S4': 2, 'GIT-S8': 2,
  'GIT-T19': 2, 'GIT-T2': 2, 'GIT-T20': 2, 'GIT-T21': 3, 'GIT-T22': 2, 'GIT-T23': 2, 'GIT-T24': 2, 'GIT-T3': 2, 'GIT-T42': 2,
  'GIT-T43': 3, 'GIT-T44': 2, 'GIT-T5': 2, 'GOAL-S12': 2, 'GOAL-S19': 2, 'GOAL-S42': 2, 'GOAL-S44': 3, 'GOAL-S57': 2, 'GOAL-S60': 2,
  'GOAL-S61': 2, 'GOAL-S62': 2, 'GOAL-S63': 2, 'GOAL-T10': 2, 'H-24': 2, 'JDG-S1': 2, 'JDG-S10': 2, 'JDG-S11': 2, 'JDG-S2': 2,
  'JDG-S25': 2, 'JDG-S26': 2, 'JDG-S6': 2, 'JDG-S9': 2, 'JDG-T39': 2, 'JDG-T40': 2, 'JDG-T41': 2, 'MEAS-S1': 2, 'MEAS-S20': 5,
  'MEAS-S21': 2, 'MEAS-S46': 2, 'MEAS-S47': 2, 'MEAS-T40': 2, 'OBS-S1': 2, 'OBS-S27': 2, 'OBS-S29': 2,
  'OBS-S24': 2, 'OBS-S30': 2, 'OBS-S31': 2, 'OBS-T75': 2, 'OBS-T76': 2, 'OBS-T77': 2, 'OBS-T78': 2, 'RUN-S1': 2, 'RUN-S14': 2, 'RUN-S21': 2,
  'RUN-S23': 2, 'RUN-S24': 2, 'RUN-S25': 2, 'RUN-S26': 2, 'RUN-T1': 2, 'RUN-T10': 2, 'RUN-T11': 2, 'RUN-T19': 2, 'RUN-T2': 2, 'RUN-T21': 2,
};

export function collectDuplicateLedgerDefinitionCounts(markdowns: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const markdown of markdowns) {
    for (const id of extractLedgerIssueDefinitionIds(markdown)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return Object.fromEntries(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** The baseline is a RATCHET, not a snapshot: it may only shrink.
 *  ⛔ Exact equality would turn *fixing* a real collision into a red test — and the whole point of
 *  this guard is that nobody runs it, so a red it produces on someone else's *improvement* is the
 *  worst possible failure mode. 실측 2026-08-25: `MEAS-T40` 이 그 사이 고쳐지자 정확일치 판이 빨개졌다.
 *  Returns one line per id whose duplicate count is NEW or GREW past the documented baseline. */
export function ledgerDefinitionDuplicateRegressions(
  actual: Record<string, number>,
  baseline: Record<string, number> = expectedDuplicateLedgerDefinitionCounts,
): string[] {
  return Object.entries(actual)
    .filter(([id, count]) => count > (baseline[id] ?? 0))
    .map(([id, count]) => `${id}: 정의 ${count}개 (문서화된 기존 ${baseline[id] ?? 0}개)`)
    .sort();
}

/** The other direction: ids the repository has since FIXED. Not a failure — a prompt to prune the
 *  baseline. ⛔ Report it rather than assert it, so the guard never punishes an improvement. */
export function ledgerDefinitionDuplicateImprovements(
  actual: Record<string, number>,
  baseline: Record<string, number> = expectedDuplicateLedgerDefinitionCounts,
): string[] {
  return Object.entries(baseline)
    .filter(([id, count]) => (actual[id] ?? 0) < count)
    .map(([id, count]) => `${id}: 정의 ${actual[id] ?? 0}개 (기준선 ${count}개 — 기준선에서 줄여도 된다)`)
    .sort();
}

/** Returns only IDs that define a ledger item at the start of a level-two or level-three heading. */
export function extractLedgerIssueDefinitionIds(markdown: string): string[] {
  return Array.from(markdown.matchAll(definitionHeading), ([, id, suffix]) =>
    continuationMarker.test(suffix!) ? undefined : id!,
  ).filter((id): id is string => id !== undefined);
}

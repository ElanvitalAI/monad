/** Goal-document filename contract shared by writers and corpus consumers. */
export const GOAL_DOCUMENT_EXTENSIONS = ['.txt', '.md'] as const;

/** Whether a filename has an extension accepted by the goal-document corpus. */
export function isGoalDocumentFileName(fileName: string): boolean {
  return GOAL_DOCUMENT_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

/** Whether a filename is a goal-author artifact accepted by closure traversal. */
export function isGoalAuthorFileName(fileName: string): boolean {
  return fileName.startsWith('GOAL-') && isGoalDocumentFileName(fileName);
}

/** Date from which new `.txt` asks must use the `ASK-` filename prefix.
 *
 * ⛔ 이 날짜를 «미래»로 두면 그날까지 이 규칙은 아무것도 안 문다 — 그러면 「지금 저장소를 훑어
 *    위반 0」이라는 판정이 «검사 대상이 0이라서» 통과한다(동어반복 판정 · `goal-context/01` ④).
 * 📏 2026-08-11 실측으로 고른 값: startDate 별 `docs/goals/*.txt` 분류
 *      2026-08-12 → 대상 0 (n/a 1049)            = 게이트가 «사문»
 *      2026-08-11 → compliant 7 · violation 0    = 게이트가 «살아 있고» 통과한다  ← 이 값
 *      2026-08-10 → violation 14                 = 기존분이 걸린다(README §0-0 이 개명을 금했다)
 * ⇒ 그래서 「오늘부터」다. 앞당기려면 위 세 수를 «다시 재고» 고른다. */
export const GOAL_TEXT_FILENAME_RULE_START_DATE = '2026-08-11';

export type GoalTextFilenameClassification = 'not-applicable' | 'compliant' | 'violation' | 'unclassifiable';

function dateFromGoalTextFileName(fileName: string): string | undefined {
  const match = /-(\d{4})-(\d{2})-(\d{2})\.txt$/.exec(fileName);
  if (!match) return undefined;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return undefined;

  return `${yearText}-${monthText}-${dayText}`;
}

function hasRequiredEvidenceSection(content: string): boolean {
  return /^\s*##\s+REQUIRED EVIDENCE\s*$/im.test(content);
}

/**
 * Classifies post-rule goal text files without reading the filesystem.
 * Post-rule asks are `ASK-*.txt` without REQUIRED EVIDENCE and author outputs
 * are `GOAL-*.txt` with it. Invalid dates remain `unclassifiable`; unknown
 * prefixes and prefix/content mismatches are violations.
 */
export function classifyGoalTextFilename(
  fileName: string,
  content: string,
  startDate = GOAL_TEXT_FILENAME_RULE_START_DATE,
): GoalTextFilenameClassification {
  if (!fileName.endsWith('.txt')) return 'not-applicable';

  const date = dateFromGoalTextFileName(fileName);
  if (!date) return 'unclassifiable';
  if (date < startDate) return 'not-applicable';

  const hasRequiredEvidence = hasRequiredEvidenceSection(content);
  if (fileName.startsWith('ASK-')) return hasRequiredEvidence ? 'violation' : 'compliant';
  if (fileName.startsWith('GOAL-')) return hasRequiredEvidence ? 'compliant' : 'violation';
  return 'violation';
}

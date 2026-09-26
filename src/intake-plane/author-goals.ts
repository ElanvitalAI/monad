/**
 * intake check → 골 저작 연결. 판정 「없음」마다 기존 골 중복을 먼저 보고, 없으면 골 저작기로 골 문서를 쓰고 lint 한 뒤 멈춘다.
 * 하니스는 발사하지 않는다. 골: 내부 문서 `ASK-intake-check-authors-goals-for-gaps-2026-09-24`
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { debug } from '../debug/log.js';
import { resolveGoalDocumentsDir } from '../self-implement/goal-documents-dir.js';
import { GAP_VERDICTS, tokensOf, type IntakeCheckItem } from './check.js';

export type IntakeAuthorStatus = 'authored' | 'already-planned' | 'over-cap' | 'author-failed' | 'no-names';

export interface IntakeAuthorOutcome {
  readonly fact: string;
  readonly status: IntakeAuthorStatus;
  /** 저작한 골 또는 이미 있는 골의 저장소 상대 경로. */
  readonly goalPath?: string;
  /** 저작한 골의 lint ERROR 수 — 0 이면 발사할 수 있다(발사는 사람이 한다). */
  readonly lintErrors?: number;
  readonly reason?: string;
}

export interface IntakeAuthorDeps {
  readonly root: string;
  /** 골 저작기 — `docs/goals/` 에 골 문서를 쓰고 경로와 본문을 돌려준다. LLM 을 부를 수 있다. */
  readonly author: (ask: string, rootIntent: string) => Promise<{ path: string; document: string }>;
  /** lint ERROR 수. */
  readonly lintErrors: (document: string) => number;
  /** 중복 확인용 기존 골 문서. 기본은 골 저작기와 같은 골 디렉토리(resolveGoalDocumentsDir)의 *.md. */
  readonly listGoalDocs?: () => readonly { path: string; text: string }[];
  readonly log?: (event: string, data: Record<string, unknown>) => void;
}

export const INTAKE_AUTHOR_DEFAULT_MAX = 3;

function defaultGoalDocs(root: string): { path: string; text: string }[] {
  // Same resolver the goal author writes with, so duplicates are looked up where new goals land.
  const dir = resolveGoalDocumentsDir(root).directory;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ path: relative(root, join(dir, name)), text: readFileSync(join(dir, name), 'utf8') }));
}

function authorAsk(item: IntakeCheckItem): string {
  // The first line leads the ask and `제목:` is the title the author forwards (parseAskProseTitle), so both are the fact.
  return [
    item.fact,
    `제목: ${item.fact}`,
    '',
    'intake check 가 바깥 지식과 elanous 현재를 대조해 「없음」으로 판정한 결손이다. 이것을 채우는 골을 쓴다.',
    '백틱 이름은 대조에 쓴 검색 표지일 뿐이다 — 그 문자열이 저장소에 생기는 것을 판정 신호로 삼지 말고, 사실이 말하는 동작을 판정 신호로 쓴다.',
    `대조 결과: ${item.current}`,
    ...(item.quotes.length > 0 ? [`출처 인용: ${item.quotes.join(' / ')}`] : []),
  ].join('\n');
}

export async function authorIntakeGoals(
  items: readonly IntakeCheckItem[],
  deps: IntakeAuthorDeps,
  opts: { max?: number; source: string },
): Promise<IntakeAuthorOutcome[]> {
  const log = deps.log ?? ((event, data) => { debug.log('intake.author', event, data); });
  const max = opts.max ?? INTAKE_AUTHOR_DEFAULT_MAX;
  const gaps = items.filter((item) => GAP_VERDICTS.includes(item.verdict));
  const outcomes: IntakeAuthorOutcome[] = [];
  let authored = 0;
  let goalDocs: readonly { path: string; text: string }[] | undefined;
  for (const item of gaps) {
    const names = tokensOf(item.fact);
    if (names.length === 0) {
      outcomes.push({ fact: item.fact, status: 'no-names', reason: '이름 토큰이 없어 중복을 확인할 수 없다' });
      continue;
    }
    goalDocs ??= (deps.listGoalDocs ?? (() => defaultGoalDocs(deps.root)))();
    const planned = goalDocs.find((doc) => names.every((name) => doc.text.includes(name)));
    if (planned) {
      outcomes.push({ fact: item.fact, status: 'already-planned', goalPath: planned.path });
      continue;
    }
    if (authored >= max) {
      outcomes.push({ fact: item.fact, status: 'over-cap', reason: `한 번에 ${max}개까지만 저작한다` });
      continue;
    }
    authored++;
    try {
      const written = await deps.author(authorAsk(item), `intake check: ${opts.source}`);
      const lintErrors = deps.lintErrors(written.document);
      outcomes.push({ fact: item.fact, status: 'authored', goalPath: written.path, lintErrors });
    } catch (error) {
      outcomes.push({ fact: item.fact, status: 'author-failed', reason: error instanceof Error ? error.message : String(error) });
    }
  }
  log('done', {
    gaps: gaps.length,
    max,
    counts: Object.fromEntries((['authored', 'already-planned', 'over-cap', 'author-failed', 'no-names'] as const)
      .map((status) => [status, outcomes.filter((row) => row.status === status).length])),
  });
  return outcomes;
}

export function renderIntakeAuthorOutcomes(outcomes: readonly IntakeAuthorOutcome[]): string {
  if (outcomes.length === 0) return '골 저작: 「없음」 항목이 없다';
  const label: Record<IntakeAuthorStatus, string> = {
    'authored': '저작됨', 'already-planned': '이미 계획됨', 'over-cap': '상한 초과', 'author-failed': '저작 실패', 'no-names': '이름 없음',
  };
  return ['골 저작 (발사는 사람이 한다):', ...outcomes.map((row) => {
    const tail = row.status === 'authored'
      ? ` → ${row.goalPath} · lint ERROR ${row.lintErrors}${row.lintErrors === 0 ? ' (발사 가능)' : ''}`
      : row.goalPath ? ` → ${row.goalPath}` : row.reason ? ` — ${row.reason}` : '';
    return `- [${label[row.status]}] ${row.fact}${tail}`;
  })].join('\n');
}

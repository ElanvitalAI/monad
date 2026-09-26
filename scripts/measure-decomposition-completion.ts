#!/usr/bin/env bun
// ⭐⭐ 「실행 결과」 자 — 분해 «조각 수» ↔ «완주율».
//
// ⛔ 왜 이 자가 있나 (2026-08-27 · 🅢 137차 · 135차가 `S5` 보류하며 못 박은 칸):
//   *"되살리려면 「실행 결과」 축(라운드 수·완주율)을 재라 — ㉙ 이 안 잰 칸"*
//   ⇒ 즉 조각 «품질»이 아니라 ***그 조각들이 「끝까지 가나」***를 재는 자다.
//
// 📏 조인: 골 문서의 `- GoalId:` ⊕ `- 조각 수:`  ↔  런 원장의 `terminal.goalId` ⊕ `runStatus`
//   ⛔ 원장은 «다섯 트리»에 흩어져 있다 — `resolveLogTargets({ all: true, includeTest: true })` 로 연합 조회한다.
//
// ⚠️⛔ **이 자가 답하지 «못하는» 것**:
//   ⓐ ***인과가 아니다*** — 「어려운 골이 더 많이 쪼개진다」가 같은 상관을 만든다. 이 자는 «연관»만 잰다.
//   ⓑ 패브릭 분해기는 프로덕션에서 «안 돌았다» ⇒ 이 표본은 ***default 분해기의 것***이다.
//   ⓒ 「라운드 수」는 아직 «안 잰다» — 원장 terminal 에 그 필드가 없다(추가되면 여기 붙인다).
//
// 사용:  bun run scripts/measure-decomposition-completion.ts [--strata]
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { queryFederatedCompletedRunLedgers, queryFederatedInterruptedRunLedgers } from '../src/self-implement/run-ledger.js';
import { resolveLogTargets } from '../src/cli/logs-cli.js';
import { logsDbPath } from '../src/mss/logging/log-store.js';

const LEDGER_LIMIT = 5000;

export interface DecompositionCompletionRow {
  goalId: string;
  pieces: number;
  completed: boolean;
  date: string;
  /** ⭐ 「같은 대상 경로에 «중단» 런이 있었나」 = ***재발사 프록시***(🅕 33차 제안 · 2026-08-27).
   *  ⛔ 이것은 「분해 제안을 설계도로 삼아 다시 쐈다」보다 «넓다» — 우연한 재시도도 걸린다. */
  priorInterruptedOnPath: number;
}

/** 연합 원장에서 `goalId → runStatus` 를 모은다. ⛔ 먼저 본 것을 이긴다(같은 골의 재시도는 첫 종단만 센다). */
export function collectGoalOutcomes(): { status: Map<string, string>; unreadable: number } {
  const targets = [...resolveLogTargets({ all: true, includeTest: true }).targets, { name: 'current', dbPath: logsDbPath() }];
  const status = new Map<string, string>();
  let unreadable = 0;
  const absorb = (
    entries: readonly { terminal?: unknown }[],
    unreadableCount: number | undefined,
    fallback: string,
  ): void => {
    unreadable += unreadableCount ?? 0;
    for (const entry of entries) {
      const terminal = entry.terminal as { goalId?: string; data?: { goalId?: string; runStatus?: string } } | undefined;
      const goalId = terminal?.goalId ?? terminal?.data?.goalId;
      if (goalId && !status.has(goalId)) status.set(goalId, terminal?.data?.runStatus ?? fallback);
    }
  };
  // ⛔ 「판독 불가」를 «0」과 다른 값으로 남긴다 — 그 수가 0 이 아니면 이 표본은 «부분»이다.
  const completed = queryFederatedCompletedRunLedgers({ targets, limit: LEDGER_LIMIT });
  absorb(completed.entries, completed.unreadableLedgerDirectoryCount, 'completed');
  const interrupted = queryFederatedInterruptedRunLedgers({ targets, limit: LEDGER_LIMIT });
  absorb(interrupted.entries, interrupted.unreadableLedgerDirectoryCount, 'interrupted');
  return { status, unreadable };
}

/** 골 문서에서 «조각 수»를 읽어 원장 결과와 조인한다. */
export function joinGoalsToOutcomes(goalsDir: string, status: Map<string, string>): DecompositionCompletionRow[] {
  const rows: DecompositionCompletionRow[] = [];
  for (const file of readdirSync(goalsDir)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(join(goalsDir, file), 'utf8');
    const goalId = /^- GoalId: ([0-9a-f]+)/m.exec(text)?.[1];
    const pieces = /^- 조각 수: (\d+)/m.exec(text)?.[1];
    const date = /(\d{4}-\d{2}-\d{2})\.md$/.exec(file)?.[1];
    if (!goalId || !pieces || !date) continue;
    const outcome = status.get(goalId);
    if (!outcome) continue;
    const prior = /\[preflight\] 중단 런:[^\n]*같은 경로 (\d+)건/.exec(text)?.[1];
    rows.push({ goalId, pieces: Number(pieces), completed: outcome === 'completed', date, priorInterruptedOnPath: prior ? Number(prior) : 0 });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** 두 비율의 z (⛔ 「유의하다」는 「인과다」가 아니다). */
export function twoProportionZ(a: DecompositionCompletionRow[], b: DecompositionCompletionRow[]): number {
  if (!a.length || !b.length) return NaN;
  const pa = a.filter((r) => r.completed).length / a.length;
  const pb = b.filter((r) => r.completed).length / b.length;
  const pooled = (a.filter((r) => r.completed).length + b.filter((r) => r.completed).length) / (a.length + b.length);
  return (pa - pb) / Math.sqrt(pooled * (1 - pooled) * (1 / a.length + 1 / b.length));
}

/** ⭐ `R-GOAL17` 의 «기전»을 재는 칸 (🅣 131차 요청 · 2026-08-27).
 *  물음: ***UNCONVERGEABLE 로 죽은 골에서, 깨진 시험이 «대상 경로 밖»인가.***
 *  ⇒ 밖이면 자식이 그 파일을 «편집할 수 없어» 같은 회귀가 반복된다 — 그것이 🅣 의 기전 주장이다.
 *
 *  🚨⭐⭐ **모집단을 `--state open` 으로 잡지 마라 — 그러면 «생존자»를 센다**(2026-08-27 실측 · 🅣 제보).
 *  사람이 draft 를 «치우면» 그 표본이 사라진다. `UNCONVERGEABLE` 은 «닫힌 뒤에도» 그 사건이다.
 *  ```
 *  --state open   UNCONVERGEABLE  ***8***   측정 가능 ***1***
 *  --state all    UNCONVERGEABLE ***21***   측정 가능 ***2***     ⇐ 모집단이 «2.6배»
 *  ```
 *  ⚠️ 그리고 `--state all --limit N` 의 N 이 모집단을 «자른다» — 그 수도 «바닥»이다.
 *
 *  ⛔⭐ **분모를 «반드시» 같이 낸다** — 이 자료는 draft PR 본문의 `- introduced: <경로> > <시험명>` 줄인데
 *  그 본문이 «절단»되면 그 줄이 통째로 사라진다. 즉 ***「밖 0건」이 「밖이 없다」가 아니라 「못 봤다」***일 수 있다.
 *  📏 2026-08-27 실측: `--state all` 로 UNCONVERGEABLE ***20건 중 «온전한 것 2건»***(85% 절단 · `OBS-T342`).
 *
 *  🪞🚨 **⛔ 「되찾을 수 없다」는 «거짓»이었다 — 30분 만에 반증됐다**(🅕 33차 · 2026-08-27):
 *  ***게이트 귀속은 관측에 «남아 있다»*** — `elanous logs --event gate.baseline` 의 `data.failures[]` 가
 *  `{ file, attribution }` 을 싣는다. 📏 실측: 행 ***394*** · runId ***102*** ·
 *  ***`attribution='introduced'` 인 파일을 가진 행 40***(PR 본문에서 온전한 것은 «둘»뿐이었다).
 *  ⇒ ✅ 그러므로 이 칸은 ***PR 본문 대신 «로그»로 소급해 채울 수 있다***.
 *  🔗 조인 경로:  `gate.baseline.data.runId` → 원장 `terminal`(runId ↔ goalId) → 골 문서 `대상 경로`
 *  ⛔ 그러니 「PR 본문이 유일한 사본」으로 읽지 마라 — ***내가 30분 그렇게 읽었고 틀렸다***.
 */
export interface MechanismRow { pr: number; targets: string[]; brokenFiles: string[]; outsideTargets: boolean }

export function classifyMechanism(body: string, pr: number): MechanismRow | 'not-unconvergeable' | 'evidence-truncated' {
  if (!/verdict: UNCONVERGEABLE/.test(body)) return 'not-unconvergeable';
  const broken = [...body.matchAll(/^- introduced: ([^\s>]+)/gm)].map((m) => m[1]);
  if (!broken.length) return 'evidence-truncated';
  const targetLine = /^대상 경로: (.+)$/m.exec(body)?.[1] ?? '';
  const targets = targetLine.split('·').map((t) => t.trim()).filter(Boolean);
  const brokenFiles = [...new Set(broken)];
  return { pr, targets, brokenFiles, outsideTargets: brokenFiles.some((f) => !targets.includes(f)) };
}

/** runId → { goalId, completed } (원장). ⛔ `collectGoalOutcomes` 는 goalId 로 접었지만 여기선 runId 가 열쇠다. */
export function collectRunIndex(): Map<string, { goalId?: string; completed: boolean }> {
  const targets = [...resolveLogTargets({ all: true, includeTest: true }).targets, { name: 'current', dbPath: logsDbPath() }];
  const index = new Map<string, { goalId?: string; completed: boolean }>();
  const absorb = (entries: readonly { terminal?: unknown }[], fallbackOk: boolean): void => {
    for (const entry of entries) {
      const t = entry.terminal as { runId?: string; goalId?: string; data?: { runId?: string; goalId?: string; runStatus?: string } } | undefined;
      const runId = t?.runId ?? t?.data?.runId;
      if (!runId || index.has(runId)) continue;
      index.set(runId, { goalId: t?.goalId ?? t?.data?.goalId, completed: (t?.data?.runStatus ?? '') === 'completed' || fallbackOk });
    }
  };
  absorb(queryFederatedCompletedRunLedgers({ targets, limit: LEDGER_LIMIT }).entries, true);
  absorb(queryFederatedInterruptedRunLedgers({ targets, limit: LEDGER_LIMIT }).entries, false);
  return index;
}

/** goalId → 「대상 경로」. ⛔ 골 문서에 «두 문면»이 있다 — 하나만 보면 표본이 준다. */
export function collectGoalTargetPaths(goalsDir: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of readdirSync(goalsDir)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(join(goalsDir, file), 'utf8');
    const goalId = /^- GoalId: ([0-9a-f]+)/m.exec(text)?.[1];
    const line = /^대상 경로: (.+)$/m.exec(text)?.[1] ?? /^- RootIntent: 대상 경로: (.+)$/m.exec(text)?.[1];
    if (!goalId || !line) continue;
    map.set(goalId, line.split('·').map((t) => t.trim()).filter(Boolean));
  }
  return map;
}

/** ⭐ `gate.baseline` 관측에서 runId → 「새로 깨진(introduced) 파일 집합」.
 *  ⛔⭐ ***원천은 PR 본문이 아니라 «로그»다*** — 본문은 85% 가 절단됐고 로그는 «안 잘린다»(🅣 131차 제보).
 *  ⚠️ 이 함수는 `elanous logs` 를 부른다(느리다 · 네트워크는 아니다). */
export function collectIntroducedFilesByRun(repoRoot: string, limit = 3000): Map<string, Set<string>> {
  const raw = new TextDecoder().decode(Bun.spawnSync(
    ['bun', 'bin/elanous.mjs', 'logs', '--all', '--include-test', '--event', 'gate.baseline', '--limit', String(limit), '--json', '--json-data'],
    { cwd: repoRoot },
  ).stdout);
  let rows: unknown[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && '_meta' in parsed) continue;
      rows.push(parsed);
    } catch { /* 로그 CLI 는 사람용 줄도 낸다 — 그것은 건너뛴다 */ }
  }
  if (rows.length === 1 && Array.isArray(rows[0])) rows = rows[0] as unknown[];
  const byRun = new Map<string, Set<string>>();
  for (const row of rows) {
    const data = (row as { data?: { runId?: string; failures?: { file?: string; attribution?: string }[] } }).data;
    if (!data?.runId || !Array.isArray(data.failures)) continue;
    const files = data.failures.filter((f) => f?.attribution === 'introduced' && f.file).map((f) => f.file as string);
    if (!files.length) continue;
    byRun.set(data.runId, new Set([...(byRun.get(data.runId) ?? []), ...files]));
  }
  return byRun;
}

if (import.meta.main) {
  const { status, unreadable } = collectGoalOutcomes();
  const rows = joinGoalsToOutcomes(resolve(import.meta.dir, '..', 'docs', 'goals'), status);
  console.log(`📏 원장 goalId ${status.size} · 조인된 골 ${rows.length} · 원장 판독 불가 ${unreadable}`);
  const buckets = new Map<string, DecompositionCompletionRow[]>();
  for (const r of rows) {
    const key = r.pieces >= 5 ? '5+' : String(r.pieces);
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  console.log('\n조각 수    n    완주    완주율');
  for (const key of [...buckets.keys()].sort()) {
    const b = buckets.get(key)!;
    const ok = b.filter((r) => r.completed).length;
    console.log(`${key.padStart(6)}  ${String(b.length).padStart(4)}  ${String(ok).padStart(5)}   ${(ok * 100 / b.length).toFixed(1)}%`);
  }
  const low = rows.filter((r) => r.pieces <= 2);
  const high = rows.filter((r) => r.pieces >= 3);
  const rate = (a: DecompositionCompletionRow[]) => a.length ? a.filter((r) => r.completed).length * 100 / a.length : NaN;
  console.log(`\n조각 1-2 ${rate(low).toFixed(1)}% (n=${low.length}) ↔ 조각 3+ ${rate(high).toFixed(1)}% (n=${high.length}) · z=${twoProportionZ(low, high).toFixed(2)}`);
  if (process.argv.includes('--mechanism')) {
    // ⭐ `R-GOAL17` 의 기전 — ⛔ ***대조군을 «같이» 낸다***(완주 런에서도 같은 비율이면 그 자는 안 가른다).
    const repoRoot = resolve(import.meta.dir, '..');
    const introduced = collectIntroducedFilesByRun(repoRoot);
    const runs = collectRunIndex();
    const goalPaths = collectGoalTargetPaths(join(repoRoot, 'docs', 'goals'));
    const cell = { badOut: 0, badIn: 0, okOut: 0, okIn: 0 };
    const lost: Record<string, number> = {};
    for (const [runId, files] of introduced) {
      const info = runs.get(runId);
      const targets = info?.goalId ? goalPaths.get(info.goalId) : undefined;
      if (!targets) {
        const why = !info ? 'runId 가 원장에 없다' : !info.goalId ? '원장에 goalId 가 없다' : '골 문서에 대상 경로가 없다';
        lost[why] = (lost[why] ?? 0) + 1;
        continue;
      }
      const outside = [...files].some((f) => !targets.includes(f));
      if (info!.completed) outside ? cell.okOut++ : cell.okIn++;
      else outside ? cell.badOut++ : cell.badIn++;
    }
    const pct = (a: number, b: number) => (a + b ? `${(a * 100 / (a + b)).toFixed(0)}%` : '—');
    console.log('\nR-GOAL17 기전 — 원천 = gate.baseline 관측 (⛔ PR 본문 아님)');
    console.log(`introduced 파일을 가진 런 ${introduced.size} · 조인 실패 ${Object.values(lost).reduce((a, b) => a + b, 0)}`);
    for (const [why, n] of Object.entries(lost)) console.log(`   ⛔ ${why}: ${n}`);
    console.log(`               대상«밖»  대상«안»   밖 비율`);
    console.log(`  ⛔ 중단 런      ${String(cell.badOut).padStart(4)}     ${String(cell.badIn).padStart(4)}     ${pct(cell.badOut, cell.badIn)}`);
    console.log(`  ✅ 완주 런      ${String(cell.okOut).padStart(4)}     ${String(cell.okIn).padStart(4)}     ${pct(cell.okOut, cell.okIn)}`);
    console.log(`  ⛔ 분모가 작으면 «수로 말하지 마라» — 방향만 읽는다`);
  }
  if (process.argv.includes('--relaunch')) {
    // ⭐ 🅕 33차 가설: 「분해기가 갈라 준 조각」과 「처음부터 쪼갠 조각」은 완주율이 다른가.
    //   📏 2026-08-27 실측: 이 프록시로는 ***안 갈린다***(77.6% ↔ 78.7% · z=0.32).
    //   ⊕ ⭐ 그리고 ***조각 수 효과는 이 층화를 «통과»한다***(1-2 ↔ 3+ 차이가 양쪽에서 유지된다).
    console.log('\n재발사 프록시(같은 경로 중단 런) 층화');
    for (const [label, keep] of [['prior=0', (r: DecompositionCompletionRow) => r.priorInterruptedOnPath === 0], ['prior>=1', (r: DecompositionCompletionRow) => r.priorInterruptedOnPath >= 1]] as const) {
      const group = rows.filter(keep);
      const l = group.filter((r) => r.pieces <= 2), h = group.filter((r) => r.pieces >= 3);
      console.log(`  ${label.padEnd(9)} 전체 ${rate(group).toFixed(1)}%(n=${group.length})  ·  1-2 ${rate(l).toFixed(1)}%(n=${l.length})  ·  3+ ${Number.isNaN(rate(h)) ? '—' : rate(h).toFixed(1) + '%(n=' + h.length + ')'}`);
    }
  }
  if (process.argv.includes('--strata')) {
    // ⛔⭐ 이 저장소는 「시대 교란」으로 여러 번 데었다 — 층화를 «기본 산출 옆»에 둔다.
    const q = Math.ceil(rows.length / 4);
    console.log('\n시대 4분위 층화 (⛔ 방향이 흔들리면 그 신호를 믿지 마라)');
    for (let i = 0; i < 4; i++) {
      const seg = rows.slice(i * q, (i + 1) * q);
      if (!seg.length) continue;
      const l = seg.filter((r) => r.pieces <= 2), h = seg.filter((r) => r.pieces >= 3);
      console.log(`  Q${i + 1} ${seg[0].date}~${seg.at(-1)!.date}  1-2 ${rate(l).toFixed(1)}% (n=${l.length})  3+ ${Number.isNaN(rate(h)) ? '—' : rate(h).toFixed(1) + '% (n=' + h.length + ')'}`);
    }
  }
}

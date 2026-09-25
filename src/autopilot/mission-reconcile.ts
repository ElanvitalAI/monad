// ── 미션 self-perception / reconcile (대표 2026-07-13·하이브리드 방향 B) ──────
//
// 원칙: 외부(Claude/Codex)가 미션의 self-memory 를 직접 write 하면 "밖에서 해치는 것"이다.
// 대신 미션이 **스스로 외부 현실(git/PR/main)을 관측해 자기 형상을 self-derive** 한다.
// 창구는 "외부→미션 write"가 아니라 "미션→현실 read"(self-perception)여야 한다(대표 지시).
//
// 이 모듈: 각 페이즈의 (기록된 상태·PR) vs (현실: PR 상태·deliverable 의 main 존재)를 대조해
// 진짜 상태를 self-derive 하고, 그 결과를 미션 자신의 working memory 에 provenance='reconcile'
// 로 self-write 한다. 외부 입력 0 — 오직 관측. (방향 A=외부 가이드 주입은 별도, 같은 장치 공유.)
//
// 순수(reconcilePhaseStatus)와 IO(gatherPhaseGroundTruth·reconcileMission)를 분리(단위테스트).

import { coordinatorRecordMemory } from './pipeline/coordinator-memory.js';
import { runGitCommand } from '../git-fs/runner.js';

/** self-derive 된 페이즈 상태(현실 기준). */
export type PerceivedStatus =
  | 'landed'            // 기록 PR 이 merge 됨(정상 랜딩)
  | 'landed-elsewhere'  // 기록 PR 은 닫혔으나 deliverable 은 main 에 있음(다른 PR 로 대체 랜딩)
  | 'incomplete'        // PR 닫힘/부재 + deliverable 도 main 에 없음(실제 미완)
  | 'pending'           // PR 이 아직 열림(머지 대기)
  | 'unknown';          // 판단 근거 부족(operational/no-op 등)

/** 페이즈의 관측된 ground-truth(외부 입력 아님·현실에서 gather). */
export interface PhaseGroundTruth {
  phaseId: string;
  phaseTitle: string;
  /** 미션이 기록한 상태(task.status: done/failed/backlog...). */
  recordedStatus: string;
  /** 미션이 기록한 PR 번호(notes 의 pull/<n>). 없으면 null. */
  recordedPr: number | null;
  /** 관측: 그 PR 의 실제 상태. */
  prState: 'MERGED' | 'CLOSED' | 'OPEN' | null;
  /** 관측: 그 PR 이 건드린 파일(deliverable). 닫힌 PR 도 조회 가능. */
  deliverables: string[];
  /** 관측: deliverable 이 현재 main 에 존재하는가(다른 PR 로 랜딩됐을 수 있음). */
  deliverableOnMain: boolean;
  /** 관측: deliverable 을 마지막으로 건드린 main 커밋 제목(랜딩 경로 추적). */
  landedCommitSubject: string;
  /** 관측: deliverable 을 실제 머지한 PR 번호(기록 PR 과 다를 수 있음 — 외부 수습 흔적). null 가능. */
  landedViaPr: number | null;
}

/** self-derive 된 페이즈 재인지 결과. */
export interface PhaseReconciliation {
  phaseId: string;
  phaseTitle: string;
  recordedStatus: string;
  recordedPr: number | null;
  perceived: PerceivedStatus;
  /** 미션의 기록 이해 != 현실. 외부에서 PR 을 주무른 흔적 등을 미션이 스스로 감지. */
  drift: boolean;
  /** 사람/에이전트가 읽을 한 줄 설명(무엇이 어긋났고 현실은 무엇인가). */
  note: string;
}

/** ★ 순수 self-derivation — ground-truth 관측값 → 현실 기준 상태·drift 도출. 외부 입력 없음.
 *  미션이 "내 기록(status·PR)이 현실과 맞나"를 스스로 판정하는 코어(단위테스트). */
export function reconcilePhaseStatus(gt: PhaseGroundTruth): PhaseReconciliation {
  const base = { phaseId: gt.phaseId, phaseTitle: gt.phaseTitle, recordedStatus: gt.recordedStatus, recordedPr: gt.recordedPr };
  const via = gt.landedCommitSubject ? ` (main 커밋: ${gt.landedCommitSubject.slice(0, 60)})` : '';

  if (gt.prState === 'MERGED') {
    return { ...base, perceived: 'landed', drift: gt.recordedStatus !== 'done',
      note: `PR #${gt.recordedPr} merged — 랜딩 확인${gt.recordedStatus !== 'done' ? ` (기록 상태 '${gt.recordedStatus}'와 불일치)` : ''}.` };
  }
  if (gt.prState === 'OPEN') {
    return { ...base, perceived: 'pending', drift: gt.recordedStatus === 'done',
      note: `PR #${gt.recordedPr} 아직 열림(머지 대기)${gt.recordedStatus === 'done' ? ` — 기록은 'done'인데 미머지(drift)` : ''}.` };
  }
  if (gt.prState === 'CLOSED') {
    if (gt.deliverableOnMain) {
      const mergedPr = gt.landedViaPr ? `다른 PR #${gt.landedViaPr}` : '다른 PR';
      return { ...base, perceived: 'landed-elsewhere', drift: true,
        note: `PR #${gt.recordedPr} 닫힘, 그러나 deliverable 은 ${mergedPr} 로 main 에 랜딩됨${via}. 기록 PR 참조 갱신 필요(자기 형상은 실제로 완료).` };
    }
    return { ...base, perceived: 'incomplete', drift: gt.recordedStatus === 'done',
      note: `PR #${gt.recordedPr} 닫힘 + deliverable 도 main 에 없음 — 실제 미완${gt.recordedStatus === 'done' ? ` (기록 'done'은 거짓·drift)` : ''}.` };
  }
  // PR 없음(operational/walker/조사/HITL-확인 등)
  if (gt.deliverableOnMain) {
    return { ...base, perceived: 'landed', drift: gt.recordedStatus !== 'done',
      note: `기록 PR 없으나 deliverable 은 main 에 있음${via} — 랜딩된 것으로 관측.` };
  }
  if (gt.recordedStatus === 'done') {
    // PR 도 deliverable 도 없지만 done — 운영/조사/HITL 확인 페이즈. 반증(닫힌 PR 등)이 없으므로
    // done 기록을 신뢰(landed). reconcile 의 역할은 "모순 감지"이지 무결점 재검증이 아니다.
    return { ...base, perceived: 'landed', drift: false,
      note: `PR 없는 운영/조사/HITL 페이즈 — done 기록 신뢰(반증 없음).` };
  }
  if (gt.recordedStatus === 'failed') {
    return { ...base, perceived: 'incomplete', drift: false, note: `PR 없음 + 실패 기록 — 현실과 일치(미완).` };
  }
  return { ...base, perceived: 'unknown', drift: false,
    note: `PR·deliverable 근거 없음(backlog/보류 추정) — 판단 보류.` };
}

/** ★ 재인지 결과 → 텔레그램 카드(순수) — 외부에서 PR 을 수습해도 미션이 스스로 현실을 관측해
 *  갱신된 형상을 대표에게 다시 통지. "외부 수습 → self-perceive → 텔레그램도 앎"의 마지막 단계. */
export function formatReconcileCard(goal: string, recs: readonly PhaseReconciliation[]): string {
  const icon = (p: PerceivedStatus): string =>
    p === 'landed' ? '✅' : p === 'landed-elsewhere' ? '✅↝' : p === 'incomplete' ? '❌' : p === 'pending' ? '⏳' : '❔';
  const drifts = recs.filter((r) => r.drift);
  const lines: string[] = [
    '🔄 미션 자기 재인지 (self-perception)',
    `골: ${goal.replace(/\s+/g, ' ').trim().slice(0, 64)}`,
    '',
  ];
  recs.forEach((r, i) => {
    lines.push(`${i + 1}. ${icon(r.perceived)} [${r.recordedStatus}→${r.perceived}]${r.recordedPr ? ` PR#${r.recordedPr}` : ''} ${r.phaseTitle.slice(0, 32)}`);
    if (r.drift) lines.push(`   └ ${r.note.slice(0, 110)}`);
  });
  lines.push('');
  // ★ 전체 랜딩 결말(대표 2026-07-13) — drift 없고 모든 페이즈가 landed 면 "대기 액션 없음"으로 마무리.
  //   원래 머지 버튼 등이 뜨던 자리인데, PR 이 모두 머지·페이즈 done 이면 아무 대기 없이 끝나는 UX.
  const allLanded = recs.length > 0 && recs.every((r) => r.perceived === 'landed' || r.perceived === 'landed-elsewhere');
  lines.push(drifts.length
    ? `⚠️ drift ${drifts.length}건 — 외부가 안 알려줘도 미션이 git/PR/main 관측으로 스스로 재인지함.`
    : allLanded
      ? '🎉 미션 전체 랜딩 완료 — 모든 페이즈 done·PR 반영. 대기 액션 없음.'
      : '✓ drift 없음 — 기록과 현실 일치(일부 미완/보류).');
  return lines.join('\n');
}

/** 셸아웃 주입(테스트). 기본 = 실 gh/git. 실패 시 빈 문자열(fail-soft). */
export interface ReconcileDeps {
  gh?: (args: string) => string;
  git?: (args: string[]) => string;
  /** 미션 페이즈 로드(기본 TaskStore). 반환: {phaseId,title,status,notes}. */
  listPhases?: (missionId: string) => Array<{ phaseId: string; title: string; status: string; notes: string[] }>;
  /** reconcile 엔트리 시각(결정론·테스트). 기본 현재. */
  now?: () => string;
  /** working memory self-write(기본 coordinatorRecordMemory·게이트). 테스트 격리. */
  writeMemory?: typeof coordinatorRecordMemory;
  log?: (s: string) => void;
}

/** notes 에서 PR 번호 추출(순수·마지막 매치=최신). 'https://github.com/.../pull/4036' 또는 'PR #4036'.
 *  ★ 마지막 매치 우선 — inject(외부 수습)가 새 PR note 를 append 하면 그게 최신 유효 PR 로 인지된다
 *  (sub8: 기록 #4039 위에 inject #4041 → 최신 #4041 사용). */
export function parsePrFromNotes(notes: readonly string[]): number | null {
  let found: number | null = null;
  for (const n of notes) {
    const m = /pull\/(\d+)|PR\s*#?(\d+)/i.exec(n);
    if (m) { const v = Number.parseInt(m[1] ?? m[2] ?? '', 10); if (v) found = v; }
  }
  return found;
}

/** 한 페이즈의 ground-truth 를 현실에서 gather(IO·주입식). 외부가 알려주는 게 아니라 관측. */
export function gatherPhaseGroundTruth(
  phase: { phaseId: string; title: string; status: string; notes: string[] },
  deps: ReconcileDeps = {},
): PhaseGroundTruth {
  const gh = deps.gh ?? defaultGh;
  const git = deps.git ?? defaultGit;
  const recordedPr = parsePrFromNotes(phase.notes);
  let prState: PhaseGroundTruth['prState'] = null;
  let deliverables: string[] = [];
  if (recordedPr) {
    const st = gh(`pr view ${recordedPr} --json state -q .state`).trim().toUpperCase();
    prState = (st === 'MERGED' || st === 'CLOSED' || st === 'OPEN') ? st : null;
    deliverables = gh(`pr view ${recordedPr} --json files -q '.files[].path'`).split('\n').map((s) => s.trim()).filter(Boolean);
  }
  // deliverable 이 main 에 존재하나(다른 PR 로 랜딩됐을 수 있음) — git ls-tree origin/main.
  // ★ 여러 deliverable 이 서로 다른 PR 로 랜딩됐을 수 있으므로(예: signal.ts=#4036·test=#4041),
  //   가장 최근에 바뀐 것(=이 페이즈의 실제 기여)의 커밋·PR 을 취한다. 그래야 sub8 이 #4036(공유
  //   파일)이 아니라 #4041(자기 산출 테스트)로 랜딩됐음을 정확히 인지.
  let onMain = false;
  let landedSubject = '';
  let landedViaPr: number | null = null;
  let bestTs = -1;
  for (const f of deliverables) {
    if (!git(['ls-tree', '-r', '--name-only', 'origin/main', '--', f]).trim()) continue;
    onMain = true;
    const ts = Number.parseInt(git(['log', '-1', '--format=%ct', 'origin/main', '--', f]).trim(), 10) || 0;
    if (ts <= bestTs) continue;
    bestTs = ts;
    landedSubject = git(['log', '-1', '--format=%s', 'origin/main', '--', f]).trim();
    const sha = git(['log', '-1', '--format=%H', 'origin/main', '--', f]).trim();
    landedViaPr = null;
    if (sha) {
      const prNum = gh(`pr list --search ${shq(sha)} --state merged --json number -q '.[0].number'`).trim();
      if (prNum) landedViaPr = Number.parseInt(prNum, 10) || null;
    }
  }
  return { phaseId: phase.phaseId, phaseTitle: phase.title, recordedStatus: phase.status,
    recordedPr, prState, deliverables, deliverableOnMain: onMain, landedCommitSubject: landedSubject, landedViaPr };
}

/** ★ 미션 self-perception 패스 — 전 페이즈의 현실을 관측→self-derive→working memory 에
 *  provenance='reconcile' 로 self-write. 외부 입력 0. drift 개수 반환. */
export function reconcileMission(missionId: string, deps: ReconcileDeps = {}): {
  reconciliations: PhaseReconciliation[];
  drifts: number;
} {
  const log = deps.log ?? (() => {});
  const write = deps.writeMemory ?? coordinatorRecordMemory;
  const now = deps.now ?? (() => new Date().toISOString());
  // ★ self-perception 은 "현재 현실"을 봐야 하므로 origin/main 을 먼저 fresh 하게 fetch(fail-soft·
  //   오프라인이면 로컬 ref 로 진행). 안 그러면 stale origin/main 으로 오래된 PR 을 잡는다.
  try { (deps.git ?? defaultGit)(['fetch', 'origin', 'main', '-q']); } catch { /* fail-soft */ }
  const phases = (deps.listPhases ?? defaultListPhases)(missionId);
  const recs: PhaseReconciliation[] = [];
  for (const ph of phases) {
    let rec: PhaseReconciliation;
    try { rec = reconcilePhaseStatus(gatherPhaseGroundTruth(ph, deps)); }
    catch (e) { log(`[reconcile] gather 실패 ${ph.phaseId}: ${e instanceof Error ? e.message : String(e)}`); continue; }
    recs.push(rec);
    // self-write: 미션이 스스로 관측한 현실을 자기 기억에 남긴다(provenance=reconcile).
    try {
      write(missionId, {
        phaseId: rec.phaseId, phaseTitle: rec.phaseTitle, kind: 'operational', at: now(),
        summary: `[self-perception${rec.drift ? '·DRIFT' : ''}] ${rec.note}`,
        reusables: [], decisions: [],
        artifacts: rec.recordedPr ? [`recorded PR #${rec.recordedPr} → ${rec.perceived}`] : [`perceived: ${rec.perceived}`],
        provenance: 'reconcile',
      });
    } catch { /* fail-soft */ }
  }
  const drifts = recs.filter((r) => r.drift).length;
  log(`[reconcile] ${missionId} — ${recs.length} 페이즈 관측 · drift ${drifts}건`);
  return { reconciliations: recs, drifts };
}

// ── 기본 IO(주입 가능) ──────────────────────────────────────────────────────

function shq(s: string): string { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

function defaultGh(args: string): string {
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    return execSync(`gh ${args}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  } catch { return ''; }
}
function defaultGit(args: string[]): string {
  try {
    const result = runGitCommand(process.cwd(), args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout;
  } catch { return ''; }
}
function defaultListPhases(missionId: string): Array<{ phaseId: string; title: string; status: string; notes: string[] }> {
  try {
    const { TaskStore } = require('../task-orchestrator/store.js') as typeof import('../task-orchestrator/store.js');
    const store = new TaskStore();
    try {
      return store.listTasks({ goalSlug: missionId })
        .filter((t) => t.surface.kind === 'subagent')
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((t) => ({ phaseId: t.id, title: t.title, status: t.status, notes: t.notes }));
    } finally { store.close(); }
  } catch { return []; }
}

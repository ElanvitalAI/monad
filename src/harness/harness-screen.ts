// 하니스 공간 화면 릴레이 (X11 forwarding식 · 2026-07-21 · 대표 co-design)
//
// 대표 지시: goal-loop 자식은 진짜 PTY이므로 그 화면을 프로세스 경계 넘어 릴레이해 터미널에서 보게 한다
// (X11 forwarding 동형). PtyShell 레지스트리는 **프로세스-로컬**(in-memory)이라 self-implement CLI(별도
// 스폰 프로세스)의 PTY 는 데몬 PWA `/v1/terminals` 로 안 보인다. → **file-based per-space 화면 버퍼**가
// 현실적 안: 드라이버가 매 poll 마다 full snapshot 을 공간 id 키 파일에 쓰고(프레임버퍼), 뷰어(`elanous self
// screen --space <id>`)가 그 파일을 읽어 렌더(라이브 follow). 텔레그램 불필요·터미널 직행.
//
// 격리: 파일 위치는 ELANOUS_STATE_DIR 스코프(테스트=.elanous-test/harness-screens·운영=~/.elanous/harness-screens)
// → self-dev 런과 뷰어가 같은 state-dir 를 봐야 함(logs --test 규율과 동형). fail-soft(화면 릴레이 실패가
// 구현을 막지 않는다). 병렬 self-dev 는 공간 id 로 분리(각 worktree 화면 별도 파일).

import { elanousStateRoot } from '../autopilot/state-paths.js';
import { basename, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { normalizeSpaceId } from './harness-space.js';

/** 화면 버퍼 디렉터리 — ELANOUS_STATE_DIR 스코프(격리)·기본 ~/.elanous. */
export function harnessScreenDir(env: NodeJS.ProcessEnv = process.env): string {
  const stateDir = env.ELANOUS_STATE_DIR?.trim();
  return join(stateDir && stateDir.length > 0 ? stateDir : elanousStateRoot(), 'harness-screens');
}

/** 화면 키의 단일 해석원: 전달된 현재 공간 id 우선, 없으면 작업 디렉터리 마지막 조각, 둘 다 없으면 기존 `unknown` 계약. */
export function resolveHarnessScreenKey(spaceId: string | undefined, cwd: string | undefined): {
  key: string;
  source: 'space-id' | 'cwd-basename' | 'unknown';
} {
  const id = spaceId?.trim();
  if (id) return { key: id, source: 'space-id' };
  const cwdBase = cwd ? basename(cwd) : '';
  if (cwdBase) return { key: cwdBase, source: 'cwd-basename' };
  return { key: 'unknown', source: 'unknown' };
}

/** 공간 id → 화면 파일 경로. id 정규화(파일명 안전). */
export function harnessScreenPath(spaceId: string, env: NodeJS.ProcessEnv = process.env): string {
  const safe = normalizeSpaceId(spaceId).replace(/\//g, '-') || 'unknown';
  return join(harnessScreenDir(env), `${safe}.screen`);
}

// ── B3 · 화면 «소유» 클레임 (2026-08-19 · 대표 지시) ────────────────────────────
//
// 🚨 무엇을 막는가
//   화면 버퍼는 ***공간 id 하나 = 파일 하나***다. 두 자가 같은 id 로 쓰면 «같은 파일»에 쓴다.
//   ⇒ 프레임이 섞이고, 그 결과는 ***「틀린 화면을 «자신 있게» 보여 주는」*** 형태다 —
//     가장 나쁜 부류다. 비어 있으면 사람이 의심이라도 하는데, 섞이면 그대로 믿는다.
//
// 📏 왜 지금 안전한가(그리고 왜 «가정»인가)
//   `headless-elanous-driver.ts` 는 현재 자식 공간 후보와 cwd를 canonical resolver에 넘긴다.
//   ⇒ 조각마다 워크트리가 다르면 키가 갈린다. ***그러나 그건 「cwd 가 다르다」는 «가정»이다.***
//   ⛔ 가정은 언젠가 깨진다 — 그때 «조용히» 깨진다. 그래서 계약으로 바꾼다.
//
// ⛔⭐ 왜 «파일»인가 — 모듈 Map 이 아니라
//   subprocess 통일(대표 2026-08-19)이면 조각들이 ***다른 프로세스***다.
//   프로세스-로컬 레지스트리로는 원리상 못 본다. ⇒ 화면 파일 옆에 클레임 파일을 둔다.
//
// ⛔ 그리고 «막지» 않는다 — 말한다. 근거:
//   ⓐ 실패로 막으면 정당한 재개(앞선 주인이 죽어 클레임만 남은 경우)까지 죽는다
//   ⓑ 우리가 아직 이 충돌을 «한 번도» 본 적이 없다 — 안 본 것을 근거로 실행을 막지 않는다
//   ⇒ 대신 ***값으로 드러낸다***. 그 수가 0이 아니면 그때 막을지 결정한다.

export interface HarnessScreenClaim {
  /** 클레임을 쥔 프로세스 pid. */
  pid: number;
  /** 클레임 시각(ms). */
  at: number;
  /** 누가 쥐었나 — 진단용 라벨(runId 등). */
  owner?: string;
}

export type HarnessScreenClaimResult =
  /** 내가 쥐었다. 앞선 주인이 없었다. */
  | { kind: 'claimed' }
  /** 앞선 클레임이 «죽은 프로세스»의 것이라 넘겨받았다. */
  | { kind: 'took-over-stale'; previous: HarnessScreenClaim }
  /** ⛔ 살아 있는 다른 프로세스가 «같은 화면»을 쥐고 있다 — 섞인다. */
  | { kind: 'conflict'; heldBy: HarnessScreenClaim };

function harnessScreenClaimPath(spaceId: string, env: NodeJS.ProcessEnv = process.env): string {
  return harnessScreenPath(spaceId, env).replace(/\.screen$/, '.claim');
}

/** 그 pid 가 살아 있나. ⛔ 「모르겠다」를 「죽었다」로 읽지 않는다 — 권한 오류(EPERM)는 «살아 있다»다. */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException)?.code === 'EPERM'; }
}

/** 지금 이 화면을 누가 쥐고 있나. 없거나 못 읽으면 `null`(둘을 «구분하지 않는다» — 소비자가 안 가른다). */
export function readHarnessScreenClaim(
  spaceId: string, env: NodeJS.ProcessEnv = process.env,
): HarnessScreenClaim | null {
  try {
    const raw = JSON.parse(readFileSync(harnessScreenClaimPath(spaceId, env), 'utf-8')) as Partial<HarnessScreenClaim>;
    if (typeof raw?.pid !== 'number' || typeof raw?.at !== 'number') return null;
    return { pid: raw.pid, at: raw.at, ...(typeof raw.owner === 'string' ? { owner: raw.owner } : {}) };
  } catch { return null; }
}

/**
 * ★ 이 화면의 «소유»를 주장한다. ⛔ 실패로 막지 않는다 — ***무슨 일이 일어났는지를 «값»으로 낸다.***
 *
 * ⚠️ 자기 자신이 다시 쥐는 것은 충돌이 아니다(같은 pid) — 재진입·재시도에서 정상이다.
 */
export function claimHarnessScreen(
  spaceId: string,
  opts: { owner?: string; pid?: number; env?: NodeJS.ProcessEnv } = {},
): HarnessScreenClaimResult {
  const env = opts.env ?? process.env;
  const pid = opts.pid ?? process.pid;
  const previous = readHarnessScreenClaim(spaceId, env);
  const mine: HarnessScreenClaim = { pid, at: Date.now(), ...(opts.owner ? { owner: opts.owner } : {}) };
  const write = (): void => {
    try {
      mkdirSync(harnessScreenDir(env), { recursive: true });
      writeFileSync(harnessScreenClaimPath(spaceId, env), JSON.stringify(mine), 'utf-8');
    } catch { /* fail-soft — 클레임 실패가 실행을 막지 않는다 */ }
  };
  if (!previous || previous.pid === pid) { write(); return { kind: 'claimed' }; }
  if (!pidAlive(previous.pid)) { write(); return { kind: 'took-over-stale', previous }; }
  // ⛔ 살아 있는 남이 쥐고 있다 — 그래도 «쓴다»(막지 않는다). 다만 사실을 낸다.
  write();
  return { kind: 'conflict', heldBy: previous };
}

/** 내 클레임을 놓는다. ⚠️ 남의 것은 «안» 지운다 — 지우면 그 자가 조용히 충돌 상태가 된다. */
export function releaseHarnessScreen(
  spaceId: string, opts: { pid?: number; env?: NodeJS.ProcessEnv } = {},
): boolean {
  const env = opts.env ?? process.env;
  const pid = opts.pid ?? process.pid;
  const current = readHarnessScreenClaim(spaceId, env);
  if (!current || current.pid !== pid) return false;
  try { rmSync(harnessScreenClaimPath(spaceId, env), { force: true }); return true; }
  catch { return false; }
}

/** 프레임(full snapshot) 을 공간 화면 버퍼에 쓴다. fail-soft(릴레이 실패가 구현을 막지 않음). */
export function writeHarnessScreen(spaceId: string, frame: string, env: NodeJS.ProcessEnv = process.env): void {
  try {
    const dir = harnessScreenDir(env);
    mkdirSync(dir, { recursive: true });
    writeFileSync(harnessScreenPath(spaceId, env), frame, 'utf-8');
  } catch { /* fail-soft — 화면 릴레이는 best-effort */ }
}

/** PTY 실행 전 하니스 스테이지 진입을 화면 버퍼에 남긴다. */
export function writeHarnessStageFrame(spaceId: string, stage: string, message: string, env: NodeJS.ProcessEnv = process.env): void {
  writeHarnessScreen(spaceId, `[${stage}] ${message}`, env);
}

/** 공간 화면 버퍼를 읽는다(없으면 null). */
export function readHarnessScreen(spaceId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  try { return readFileSync(harnessScreenPath(spaceId, env), 'utf-8'); } catch { return null; }
}

/** ★ 하니스 poll-루프 heartbeat(INC-1 근본특정·2026-07-21) — 동기 writeFileSync 라 이벤트루프가 얼려도
 *  마지막 상태가 디스크에 남는다(버퍼드 debug.log 는 freeze 시 flush 못 함). hang 재발 시 `.hb` 를 읽어
 *  **루프가 iterate 중이었나(i 증가) vs frozen(i 고정)** + 완료감지 상태를 결정적으로 판정. 뷰=`elanous self screen --hb`. */
export function writeHarnessHeartbeat(spaceId: string, state: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): void {
  try {
    const dir = harnessScreenDir(env);
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${harnessScreenPath(spaceId, env).replace(/\.screen$/, '')}.hb`, JSON.stringify({ ...state, at: Date.now() }), 'utf-8');
  } catch { /* fail-soft */ }
}

/** heartbeat 읽기(없으면 null). hang 진단용. */
export function readHarnessHeartbeat(spaceId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  try { return readFileSync(`${harnessScreenPath(spaceId, env).replace(/\.screen$/, '')}.hb`, 'utf-8'); } catch { return null; }
}

/** 화면 프레임에서 ANSI/터미널 제어 시퀀스를 제거한다(로그/parked 표시용 "docker logs" 클린업).
 *  headless 관측 경로라 tui.ts(무거운 UI)를 끌어오지 않고 로컬 경량 strip 을 쓴다. 순수. */
export function stripScreenAnsi(frame: string): string {
  return frame
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI (커서·색·모드)
    .replace(/\x1b[()][AB0]/g, '')             // charset 지정
    .replace(/\x1b[=>]/g, '')                  // keypad 모드
    .replace(/\r/g, '');
}

/** goal-loop 화면의 종결 상태 판정 — 자식이 GOAL-COMPLETE 로 끝났나(성공) vs 미완/진행.
 *  ⭐ 관측 핵심(2026-07-21 대표 co-design): 오케스트레이터의 exit-code 신호가 **detached PTY goal-loop**
 *  과 단절될 때(자식은 성공했는데 스폰 프로세스는 조기 exit) 화면 버퍼가 유일한 cross-process 진실원.
 *  단독 줄 GOAL-COMPLETE(run-goal-loop 마커 규율 동형) 만 'complete'. 순수. */
export function detectScreenGoalOutcome(frame: string): 'complete' | 'incomplete' | null {
  const clean = stripScreenAnsi(frame);
  if (clean.split('\n').some((l) => l.trim() === 'GOAL-COMPLETE')) return 'complete';
  if (/GOAL-INCOMPLETE|goal[- ]?incomplete|타임아웃 true|no_progress/i.test(clean)) return 'incomplete';
  return null;
}

/** 공간 화면 버퍼의 클린 tail(마지막 maxLines 줄·ANSI 제거) + 종결 상태. 없으면 null.
 *  parked/logs 가 자식 goal-loop 전사를 재현 없이 보여주는 "docker logs <id>" 등가물. */
export function readHarnessScreenTail(
  spaceId: string,
  maxLines = 40,
  env: NodeJS.ProcessEnv = process.env,
): { text: string; outcome: 'complete' | 'incomplete' | null; path: string } | null {
  const raw = readHarnessScreen(spaceId, env);
  if (raw === null) return null;
  const clean = stripScreenAnsi(raw);
  const lines = clean.split('\n').filter((l) => l.trim().length > 0);
  const tail = lines.slice(-maxLines).join('\n');
  return { text: tail, outcome: detectScreenGoalOutcome(raw), path: harnessScreenPath(spaceId, env) };
}

export interface HarnessScreenEntry { spaceId: string; path: string; mtimeMs: number; bytes: number }

/** 활성 화면 버퍼 목록(최신 mtime 순). --space 생략 시 최신 선택·목록 표시에 사용. */
export function listHarnessScreens(env: NodeJS.ProcessEnv = process.env): HarnessScreenEntry[] {
  try {
    const dir = harnessScreenDir(env);
    return readdirSync(dir)
      .filter((f) => f.endsWith('.screen'))
      .map((f) => {
        const path = join(dir, f);
        const st = statSync(path);
        return { spaceId: f.replace(/\.screen$/, ''), path, mtimeMs: st.mtimeMs, bytes: st.size };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch { return []; }
}

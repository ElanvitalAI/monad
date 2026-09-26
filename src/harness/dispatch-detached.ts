// ── dev-harness subprocess 위임 (#24 A · 2026-07-21) ─────────────────────────────────
//
// 근본: 하니스(P→E→R→D·grounding·review·자식구동)가 데몬 메인 이벤트루프에서 돌면, 어떤 **동기 op**든
//   데몬을 굶긴다(telegram 폴링/HTTP 정지=무응답). watchdog+대조실험으로 실증: 인프로세스 동기 op→stall,
//   subprocess 이관→정상. 그래서 데몬이 하니스를 **별도 프로세스**로 돌리면 데몬 메인루프는 절대 안 막힌다.
//
// 범위: **모든 autoDrive**(off/safe/on) 위임 — off/safe 의 HITL(confirm/question)은 자식↔부모 양방향
//   IPC 로 릴레이한다(#24 완결·2026-07-21). 자식은 stdout `HITLREQ:` 로 승인/질문을 요청하고, 부모가
//   진짜 surface 채널(telegram 등)로 물어 stdin `HITLRES:` 로 회신한다(detached-hitl.ts). 진행보고는
//   stdout `PROGRESS:`(라이브 카드) + 공유 logs.db(`elanous logs`) 둘 다.

import { spawn } from 'node:child_process';
import { resolveMainRepoRoot } from '../git-fs/worktree.js';
import { debug } from '../debug/log.js';
import { harnessSpaceEnv, resolveRunIdentity } from './harness-space.js';
import { makeLineBuffer, handleHitlReqLine, HITL_REQ_PREFIX, type HitlRelay } from './detached-hitl.js';

/** subprocess 인자 직렬화(base64 JSON) — 셸 이스케이프 회피. */
export function encodeDetachedPayload(rawArgs: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(rawArgs), 'utf-8').toString('base64');
}
export function decodeDetachedPayload(payload: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')) as Record<string, unknown>;
}

/** Shared fields for versioned structured progress carried on one stdout line. */
interface DetachedProgressFrameBase {
  version: 1;
  planId?: string;
  seq: number;
  humanLine?: string;
}

/** A plan declaration never carries a step identifier. */
interface DetachedPlanProgressFrame extends DetachedProgressFrameBase {
  kind: 'plan';
  stepId?: never;
}

/** A step update may identify its step when that identity is available. */
interface DetachedStepProgressFrame extends DetachedProgressFrameBase {
  kind: 'step';
  stepId?: string;
}

export type DetachedProgressFrame = DetachedPlanProgressFrame | DetachedStepProgressFrame;

/** Dedicated prefix so structured frames cannot be mistaken for legacy progress or results. */
export const DETACHED_PROGRESS_FRAME_PREFIX = 'PROGRESS_FRAME:';
const STRICT_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Normalize the sole supported structured-progress schema for both producers and consumers. */
function normalizeDetachedProgressFrame(value: unknown): DetachedProgressFrame | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const frame = value as Record<string, unknown>;
  const allowedKeys = new Set(['version', 'kind', 'planId', 'stepId', 'seq', 'humanLine']);
  if (Object.keys(frame).some((key) => !allowedKeys.has(key))
    || frame.version !== 1 || (frame.kind !== 'plan' && frame.kind !== 'step')
    || !Number.isSafeInteger(frame.seq) || (frame.seq as number) < 0
    || (frame.planId !== undefined && typeof frame.planId !== 'string')
    || (frame.stepId !== undefined && typeof frame.stepId !== 'string')
    || (frame.humanLine !== undefined && typeof frame.humanLine !== 'string')) return null;

  const shared = {
    version: 1 as const,
    ...(frame.planId === undefined ? {} : { planId: frame.planId as string }),
    seq: frame.seq as number,
    ...(frame.humanLine === undefined ? {} : { humanLine: frame.humanLine as string }),
  };
  if (frame.kind === 'plan') {
    if (Object.hasOwn(frame, 'stepId')) return null;
    return { ...shared, kind: 'plan' };
  }
  return {
    ...shared,
    kind: 'step',
    ...(frame.stepId === undefined ? {} : { stepId: frame.stepId as string }),
  };
}

/** Shared complete-line framing: a dedicated prefix followed by canonical base64 JSON. */
export function encodeDetachedFrame<T>(prefix: string, value: T): string {
  return `${prefix}${Buffer.from(JSON.stringify(value), 'utf-8').toString('base64')}`;
}

/** Decode a complete prefixed base64 JSON line and normalize it without throwing. */
export function decodeDetachedFrame<T>(line: string, prefix: string, normalize: (value: unknown) => T | null): T | null {
  if (!line.startsWith(prefix)) return null;
  const payload = line.slice(prefix.length);
  if (!payload || !STRICT_BASE64_PATTERN.test(payload)) return null;
  try {
    const decoded = Buffer.from(payload, 'base64');
    if (decoded.toString('base64') !== payload) return null;
    return normalize(JSON.parse(decoded.toString('utf-8')));
  } catch {
    return null;
  }
}

/** Structured progress serialization reuses the detached payload's base64 JSON transport. */
export function encodeDetachedProgressFrame(frame: DetachedProgressFrame): string {
  const normalized = normalizeDetachedProgressFrame(frame);
  if (!normalized) throw new TypeError('Invalid detached progress frame');
  return encodeDetachedFrame(DETACHED_PROGRESS_FRAME_PREFIX, normalized);
}

/** Decode and validate a complete structured-progress stdout line; invalid frames are ignored. */
export function decodeDetachedProgressFrame(line: string): DetachedProgressFrame | null {
  return decodeDetachedFrame(line, DETACHED_PROGRESS_FRAME_PREFIX, normalizeDetachedProgressFrame);
}

/** subprocess stdout 에서 최종 결과/진행/구조 진행을 추출(순수·테스트가능).
 *  프로토콜: 진행=`PROGRESS:<msg>` · 구조=`PROGRESS_FRAME:<base64 JSON>` · 최종=`RESULT:<output>`(마지막 것 채택). */
export function parseDetachedStdout(stdout: string): {
  result: string | null;
  progress: string[];
  structuredProgress: DetachedProgressFrame[];
} {
  const progress: string[] = [];
  const structuredProgress: DetachedProgressFrame[] = [];
  let result: string | null = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('PROGRESS:')) progress.push(line.slice('PROGRESS:'.length));
    else if (line.startsWith('RESULT:')) result = line.slice('RESULT:'.length);
    else {
      const frame = decodeDetachedProgressFrame(line);
      if (frame) structuredProgress.push(frame);
    }
  }
  return { result, progress, structuredProgress };
}

/** 데몬 → 자식 위임 옵션. */
export interface DetachedDispatchOpts {
  /** 자식 PROGRESS: 라인 → 데몬 surface 라이브 카드. */
  onProgress?: (msg: string) => void;
  /** 자식 HITLREQ: 라인 → 진짜 채널 relay(부모 SurfaceUx.confirm/question 그대로 넘김). 없으면
   *  자식 confirm=fail-closed(false)·question=null(off/safe 비인터랙티브와 동일). */
  hitlRelay?: HitlRelay;
}

/** Detached payload와 부모 환경에서 run identity를 SSOT로 해석한다. */
export function resolveDetachedRunIdentity(
  rawArgs: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): { runId: string; source: 'explicit' | 'inherited' | 'minted' } {
  return resolveRunIdentity({ explicit: typeof rawArgs.runId === 'string' ? rawArgs.runId : undefined, env });
}

/** 데몬이 하니스를 subprocess 로 위임 실행. 부모(데몬) 이벤트루프는 async 로 대기 → 무블로킹.
 *  configDir/stateDir 격리는 env 상속(process.env)로 subprocess 에 전파. off/safe 의 HITL 은
 *  stdin/stdout 라인 프로토콜(detached-hitl)로 자식↔부모 릴레이. */
export function dispatchRunDevHarnessDetached(
  rawArgs: Record<string, unknown>,
  opts?: DetachedDispatchOpts | ((msg: string) => void),
): Promise<{ output: string }> {
  // 하위호환: 두번째 인자가 함수면 onProgress 로 취급.
  const o: DetachedDispatchOpts = typeof opts === 'function' ? { onProgress: opts } : (opts ?? {});
  return new Promise((resolve) => {
    const binRoot = resolveMainRepoRoot(process.cwd()) ?? process.cwd();
    const payload = encodeDetachedPayload(rawArgs);
    // ★ 자기인지 공간 마커(2026-07-21) — 자식(격리 하니스 공간)이 "나는 <kind> 격리 공간의 elanous"임을
    //   self-recognize 하게 SPACE/SPACE_ID 를 심는다(자식이 다시 스폰하는 goal-loop 도 env 상속). kind 는
    //   위임 종류(dev-harness|solve-mission), id 는 objective slug. ELANOUS_HARNESS_DETACHED(재귀 가드)와 직교.
    const spaceKind = rawArgs._detachedKind === 'solve-mission' ? 'solve-mission' : 'dev-harness';
    const spaceId = String(rawArgs.objective ?? rawArgs.goal ?? rawArgs.feature ?? rawArgs.mission_id ?? '').slice(0, 48);
    // ★ K run-identity(2026-07-25·[[PLAN §K]]·MF1) — 부모가 구운 runId를 최우선으로, 없으면 상속·mint
    //   순으로 SSOT에서 해석한다. process.env를 바꾸지 않아 반복 dispatch의 identity bleed를 막고, 자식에는
    //   harnessSpaceEnv 명시 stamp로만 전파한다 → K3 pty_manifest join.
    const { runId, source: runIdSource } = resolveDetachedRunIdentity(rawArgs);
    const child = spawn('bun', [`${binRoot}/bin/elanous.mjs`, 'harness', 'run-detached', payload], {
      cwd: process.cwd(),
      // ★ configDir/stateDir 격리 상속 + ELANOUS_HARNESS_DETACHED=1(재귀 위임 가드 — subprocess 안에선
      //   dispatchRunDevHarness 가 다시 detached 로 안 빠지고 인프로세스 실행) + 공간 자기인지 마커.
      env: { ...process.env, ELANOUS_HARNESS_DETACHED: '1', ...harnessSpaceEnv(spaceKind, spaceId, runId) },
      // stdin 'pipe' — 부모→자식 HITLRES 회신 경로(#24 완결). 없으면 off/safe HITL 이 안 돌아온다.
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    debug.log('harness.frontdoor', 'detached-spawn', { pid: child.pid ?? null, autoDrive: rawArgs.auto_drive, hitlRelay: !!o.hitlRelay });
    debug.log('run-identity', 'bind', { runId, runIdSource, kind: spaceKind, spaceId, pid: child.pid ?? null, via: 'detached' });
    let out = ''; let err = '';
    const sendToChild = (line: string): void => { try { child.stdin?.write(`${line}\n`); } catch { /* fail-soft */ } };
    // 라인 버퍼 — HITLREQ JSON 이 청크 경계에서 안 쪼개지게. PROGRESS 는 라이브 카드, HITLREQ 는 relay.
    const onStdoutLine = (line: string): void => {
      if (line.startsWith('PROGRESS:')) {
        try { o.onProgress?.(line.slice('PROGRESS:'.length)); } catch { /* fail-soft */ }
      } else if (line.startsWith(HITL_REQ_PREFIX)) {
        if (o.hitlRelay) {
          const relay = o.hitlRelay;
          void handleHitlReqLine(line, relay, sendToChild).then((handled) => {
            if (handled) debug.log('harness.frontdoor', 'detached-hitl-relayed', { pid: child.pid ?? null });
          });
        } else {
          // relay 없음 → fail-closed 회신(자식이 매달리지 않게). confirm=false·question=null.
          void handleHitlReqLine(line, { confirm: async () => false, question: async () => null }, sendToChild);
        }
      }
    };
    const feedStdout = makeLineBuffer(onStdoutLine);
    child.stdout?.on('data', (d: Buffer) => { const s = d.toString(); out += s; feedStdout(s); });
    child.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('error', (e: Error) => {
      debug.log('harness.frontdoor', 'detached-error', { error: String(e?.message ?? e).slice(0, 200) }, { level: 'error' });
      resolve({ output: `RunDevHarness ⚠️ subprocess 위임 실패: ${String(e?.message ?? e).slice(0, 200)}` });
    });
    child.on('exit', (code: number | null) => {
      const { result } = parseDetachedStdout(out);
      const output = result ?? (err.trim().slice(-500) || `RunDevHarness ⚠️ subprocess 종료(code=${code}) — 결과 없음`);
      debug.log('harness.frontdoor', 'detached-done', { code, hasResult: result !== null });
      resolve({ output });
    });
  });
}

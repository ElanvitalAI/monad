// ── 결정적-순간 키프레임 PNG 캡처 (스마트 PNG 1차·결정론 게이트 · 2026-07-25) ──────────
//
// 대표 제안(2026-07-25·M2 도그푸드): executor 화면을 텍스트 프레임으로만 관측 → **중간중간 결정적
// 장면을 캡처하고 원본 PNG 로도 쉽게 추출**되는 구조 필요([[BACKLOG-intelligent-keyframe-png-capture-2026-07-25]]).
//
// 1차 = **결정론 게이트**(무료·즉시·놓침 적음): `classifyFrameState`(frame-state-detect) 로 화면-상태를
// 분류하고, **상태 전이**(idle→working, working→blocked, →done 등)를 "결정적 순간"으로 본다. 매 프레임
// sharp 래스터(비쌈)를 피하고 전이 때만 `PtyHandle.renderScreenPng()` 를 뽑아 저장 → `SelfReportFrame.pngRef`
// 스탬프. 2차(G5 브레인 capture 액션·미묘한 순간 LLM 판단)는 백로그.
//
// 저장 격리: `harnessScreenDir()`(ELANOUS_STATE_DIR 스코프) 하위 `keyframes/`. 키 = runId(K join anchor)⨯
// ptyId⨯seq⨯state → `elanous self run <runId> --png` 추출과 정합. 전부 fail-soft(캡처 실패가 goal-loop 무해).

import { join } from 'node:path';
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { harnessScreenDir } from '../harness/harness-screen.js';
import type { FrameState } from './frame-state-detect.js';

/** 키프레임 저장 디렉터리 — 화면 버퍼와 같은 state-dir 스코프 하위 `keyframes/`. */
export function keyframeDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(harnessScreenDir(env), 'keyframes');
}

/** 파일명 안전 토큰. ⚠️ 하이픈은 키 구분자(`kf-<run>-<pty>-<seq>-<state>`)이므로 **값에서 제거**해야
 *  프리픽스 필터·파서가 모호해지지 않는다(review must-fix: runId/ptyId 에 하이픈 있으면 다른 run 포함/오파싱). */
function safeToken(s: string): string {
  return (s || 'unknown').replace(/[^a-zA-Z0-9_.]/g, '_').slice(0, 80);
}

/**
 * ⭐ 결정론 게이트 — 이 전이가 "결정적 순간"인가(순수·무료).
 * 규칙: 상태가 **바뀌었고**(prev !== cur) cur 가 `unknown`(노이즈)이 아닐 때만 캡처.
 * unknown→known 은 신호(첫 분류)이므로 캡처, known→unknown 은 스킵(화면 스크롤 등 노이즈).
 */
export function isKeyframeMoment(prev: FrameState | null, cur: FrameState): boolean {
  if (cur === 'unknown') return false;
  return prev !== cur;
}

/** run(또는 space)⨯ptyId⨯seq⨯state 키 → 키프레임 PNG 경로. `kf-<key>-<ptyId>-<seq3>-<state>.png`. */
export function keyframePath(
  runOrSpace: string,
  ptyId: string,
  seq: number,
  state: FrameState,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const seq3 = String(seq).padStart(3, '0');
  return join(keyframeDir(env), `kf-${safeToken(runOrSpace)}-${safeToken(ptyId)}-${seq3}-${state}.png`);
}

/** 키프레임 PNG 를 쓴다. fail-soft(캡처 실패가 executor/goal-loop 를 절대 안 깨뜨림). 성공 시 true. */
export function writeKeyframePng(path: string, png: Buffer, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    mkdirSync(keyframeDir(env), { recursive: true });
    writeFileSync(path, png);
    return true;
  } catch {
    return false; // fail-soft — 키프레임은 best-effort 관측
  }
}

export interface KeyframeEntry { path: string; ptyId: string; seq: number; state: string; bytes: number;
  /** 파일 mtime(ms) — **전역 캡처 시각**. seq 는 ptyId별 로컬 순번이라, 다중 PTY run 을 시간순으로 정렬할 땐 이걸 쓴다. */
  mtimeMs: number }

/** 파일명에서 메타 파싱: `kf-<key>-<ptyId>-<seq>-<state>.png`. key/ptyId 는 하이픈 무함(safeToken)이라
 *  `[^-]+` 로 명확 분리. seq 는 `\d{3,}`(1000+ 도 견고·should-fix). */
function parseKeyframeName(file: string): { ptyId: string; seq: number; state: string } | null {
  const m = /^kf-[^-]+-([^-]+)-(\d{3,})-([a-z]+)\.png$/.exec(file);
  if (!m) return null;
  return { ptyId: m[1], seq: Number(m[2]), state: m[3] };
}

/**
 * 한 run(또는 space) 의 키프레임 목록(seq 순). `elanous self run <runId> --png` 추출의 소스.
 * runOrSpace 프리픽스(safeToken)로 필터. 없으면 빈 배열.
 */
export function listKeyframes(runOrSpace: string, env: NodeJS.ProcessEnv = process.env): KeyframeEntry[] {
  const key = safeToken(runOrSpace);
  try {
    const dir = keyframeDir(env);
    return readdirSync(dir)
      .filter((f) => f.startsWith(`kf-${key}-`) && f.endsWith('.png'))
      .map((f) => {
        const meta = parseKeyframeName(f);
        if (!meta) return null;
        const path = join(dir, f);
        const st = statSync(path);
        return { ...meta, path, bytes: st.size, mtimeMs: st.mtimeMs };
      })
      .filter((e): e is KeyframeEntry => e !== null)
      // 기본 정렬 = seq(--png 추출 계약·단일 PTY 시간순). 전역 시각 정렬이 필요한 소비자(다중 PTY 하이라이트릴)는
      // KeyframeEntry.mtimeMs 로 재정렬한다(buildRunHighlightReel).
      .sort((a, b) => a.seq - b.seq);
  } catch {
    return [];
  }
}

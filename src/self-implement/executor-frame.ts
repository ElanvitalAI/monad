// ── executor 화면 → SelfReportFrame (G9 P3b · 2026-07-25) ──────────────────────
//
// PTY-spawn executor(monad-chat headless goal-loop 등)의 렌더 화면을 TUI 와 **같은 프레임 버스**로
// 발행하기 위한 순수 빌더. surfaceId = execSurfaceId(ptyId)(P3a·Q1 규약 = P3a execSurfaceId 의 첫 실소비자),
// runId = K4 run-identity(부재 시 생략·round-trip 정합). executor 화면이 fleet/observatory/G5 구독자에게
// 관측되고 run 단위로 join 된다(관측→검증 접합). cols/rows 는 렌더 텍스트에서 파생(pty 핸들이 dims 미노출).

import type { SelfReportFrame } from '../capture/self-report-frame.js';
import { execSurfaceId } from './executor-contract.js';

export function buildExecutorSelfReportFrame(input: {
  ptyId: string;
  runId?: string;
  rendered: string;
  at: number;
  instance: string;
  /** on-demand PNG 포인터(경로/id·never inline) — 결정적-순간 키프레임 캡처 시 스탬프([[keyframe-capture]]). */
  pngRef?: string;
}): SelfReportFrame {
  // ⚠️ 계약(should-fix): rendered 는 renderScreen() 의 **post-ANSI grid**(escape 시퀀스 없음)라 String.length
  //   가 곧 셀 수 ≈ 열 수다. 단 한글/전각(2-width)은 1 JS char 로 세어 undercount 가능 — cols/rows 는 관측
  //   메타(대략치)이지 정밀 레이아웃 계약이 아니다(소비자는 text 를 렌더). 정밀 표시폭이 필요해지면 별도 축.
  const lines = input.rendered.split('\n');
  const rows = lines.length;
  const cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return {
    surfaceId: execSurfaceId(input.ptyId),
    instance: input.instance,
    kind: 'headless',
    mode: 'forwarded',
    text: input.rendered,
    cols,
    rows,
    at: input.at,
    // K4 — run 밖(빈 runId)이면 필드 생략(serialization round-trip 계약: non-empty 만 실음).
    ...(input.runId ? { runId: input.runId } : {}),
    // 키프레임 캡처 시에만(전이 순간) 실음 — 대부분 프레임은 pngRef 없음(never inline·on-demand).
    ...(input.pngRef ? { pngRef: input.pngRef } : {}),
  };
}

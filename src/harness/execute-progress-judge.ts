// Execute 진행 judge (task#22 part2-B · 2026-07-21) — 능동 UX 전달자 2·3차.
//
// DESIGN-executor-progress-push-pull §2.1: raw goal-loop 스트림(runHeadlessGoalLoopPty.onProgress·매 poll)
// 을 **의미 비트로 debounce** 해서만 emit — 매 프레임 push 금지(도배). 2차=마일스톤(툴콜/파일수/마지막
// 액션·debounce 간격), 3차=stall(무활동 N초→"아직 작업 중"). emit 은 SurfaceUx.progress(→ 카드) 로.
//
// 순수(now 주입·테스트 가능). 관측(제1원칙)은 호출측(harness-seams)이 판단 결과를 남긴다.

/** ANSI/제어 시퀀스 제거(headless-monad-driver 와 동형·중복 최소). */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[P_^X][^\x1B]*\x1B\\/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[@-Z\\-_=>]/g, '');
}

export interface ExecuteProgressJudgeOptions {
  /** 마일스톤 최소 emit 간격(ms). 기본 12s — 도배 방지. */
  debounceMs?: number;
  /** 무활동 stall 임계(ms). 기본 45s. */
  stallMs?: number;
  /** 시계(테스트 주입). 기본 Date.now. */
  now?: () => number;
}

/**
 * goal-loop 델타 스트림 → 의미 비트 emit(마일스톤/stall). runHeadlessGoalLoopPty.onProgress 로 **매 poll**
 * (빈 델타 포함) 먹인다: 델타 있으면 카운터 갱신 + debounce 마일스톤, 없으면 stall 판정.
 * @returns onProgress(delta) — poll 마다 호출.
 */
export function buildExecuteProgressJudge(
  emit: (msg: string) => void,
  opts: ExecuteProgressJudgeOptions = {},
): (delta: string) => void {
  const debounceMs = opts.debounceMs ?? 12_000;
  const stallMs = opts.stallMs ?? 45_000;
  const now = opts.now ?? Date.now;
  const startAt = now();
  let toolCalls = 0;
  const files = new Set<string>();
  let lastLine = '';
  let lastActivityAt = startAt;
  let lastEmitAt = Number.NEGATIVE_INFINITY; // 첫 유의미 델타는 즉시 emit(이후 debounce).

  return (delta: string): void => {
    const t = now();
    const clean = delta ? stripAnsi(delta) : '';
    if (clean.trim()) {
      lastActivityAt = t;
      // 툴콜 카운트(⏺ Name() 렌더 라인) + 파일 편집 추출.
      toolCalls += (clean.match(/⏺\s+\w+\(/g) || []).length;
      for (const m of clean.matchAll(/⏺\s+(?:Edit|Write|MultiEdit)\(([^),]+)/g)) {
        const f = m[1]!.trim(); if (f) files.add(f);
      }
      const lines = clean.split('\n').map((s) => s.trim()).filter(Boolean);
      if (lines.length) lastLine = lines[lines.length - 1]!.slice(0, 80);
      // 2차 — debounce 마일스톤.
      if (t - lastEmitAt >= debounceMs) {
        lastEmitAt = t;
        const parts = [`🔨 구현 중 · 툴콜 ${toolCalls}`];
        if (files.size) parts.push(`${files.size}파일`);
        if (lastLine) parts.push(lastLine);
        emit(parts.join(' · '));
      }
    } else {
      // 3차 — stall(무활동). 최근 emit 도 stallMs 지났을 때만(중복 방지).
      if (t - lastActivityAt >= stallMs && t - lastEmitAt >= stallMs) {
        lastEmitAt = t;
        emit(`⏳ 작업 중… (${Math.round((t - startAt) / 1000)}s · 마지막: ${lastLine || '…'})`);
      }
    }
  };
}

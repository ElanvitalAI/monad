// 완료 선언 판정 — 실측 결함(2026-07-27)의 회귀 고정.
//
// 결함: poll 루프는 `includes` 로 끊고 결과 회계는 라인 앵커로 미완이라 적어, **끊어놓고 미완으로
// 기록**하는 상태가 났다(run-16161538 · run-6572db2c). 여기서 두 방향을 다 고정한다 —
// **언급은 선언이 아니다**(오탐) ⊕ **진짜 선언은 실화면 여백을 견딘다**(놓침).

import { describe, it, expect } from 'bun:test';
import {
  COMPLETION_MARKER,
  findCompletionMarkerLine,
  hasCompletionMarker,
  mentionsMarkerWithoutDeclaring,
} from './completion-marker.js';

describe('언급은 선언이 아니다 (오탐 방향 · 자기 참조 함정)', () => {
  it('자기 소스 한 줄이 화면에 떠도 완료가 아니다', () => {
    // 실제 재현 형태 — 자식이 elanous 소스를 Read/Grep 해 화면에 띄운 줄.
    const screen = [
      '  ⏺ Grep({"pattern":"GOAL-COMPLETE","path":"/w/src/self-implement"})',
      "     ↳ 550: const markerLine = findCompletionMarkerLine(stripAnsi(snap));",
      "     ↳ 162: if (hasCompletionMarker(stripAnsi(cur))) { reached = true; break; }",
      '',
    ].join('\n');
    expect(hasCompletionMarker(screen)).toBe(false);
    expect(mentionsMarkerWithoutDeclaring(screen)).toBe(true);
  });

  it('⭐ 완료를 **부정하는** 문장이 완료 판정을 만들지 않는다', () => {
    // 실측 그대로 — 자식이 "선언하지 않겠다"고 말한 문장 때문에 부모가 끊었다.
    const screen = '따라서 워킹트리 변경은 미검증·불완전 상태이며 GOAL-COMPLETE를 선언하지 않습니다.\n';
    expect(hasCompletionMarker(screen)).toBe(false);
    expect(mentionsMarkerWithoutDeclaring(screen)).toBe(true);
  });

  it('마커가 다른 토큰과 같은 줄에 있으면 선언이 아니다', () => {
    expect(hasCompletionMarker('done. GOAL-COMPLETE 를 아직 못 씀')).toBe(false);
    expect(hasCompletionMarker('prefix-GOAL-COMPLETE')).toBe(false);
    expect(hasCompletionMarker('GOAL-COMPLETE-suffix')).toBe(false);
  });

  it('마커가 아예 없으면 언급도 선언도 아니다', () => {
    const screen = '  ⏺ Read(a)\n작업 중…\n';
    expect(hasCompletionMarker(screen)).toBe(false);
    expect(mentionsMarkerWithoutDeclaring(screen)).toBe(false);
    expect(findCompletionMarkerLine(screen)).toBeUndefined();
  });
});

describe('진짜 선언은 실화면 여백을 견딘다 (놓침 방향)', () => {
  it('단독 줄 마커 = 선언', () => {
    expect(hasCompletionMarker('요약 …\nGOAL-COMPLETE\n')).toBe(true);
  });

  it('터미널 우측 패딩 공백이 붙어도 선언', () => {
    // 200칸 화면에 쓰인 줄은 오른쪽이 공백으로 채워진다.
    expect(hasCompletionMarker(`done\n${COMPLETION_MARKER}${' '.repeat(180)}\n`)).toBe(true);
  });

  it('CRLF·선행 들여쓰기·NBSP 가 있어도 선언', () => {
    expect(hasCompletionMarker(`a\r\n   ${COMPLETION_MARKER}  \r\n`)).toBe(true);
    expect(hasCompletionMarker(`a\n ${COMPLETION_MARKER} \n`)).toBe(true);
  });

  it('마지막 줄에 개행이 없어도 선언', () => {
    expect(hasCompletionMarker(`a\n${COMPLETION_MARKER}`)).toBe(true);
  });

  it('선언 줄을 돌려준다(끊은 근거를 관측에 실을 수 있게)', () => {
    const line = findCompletionMarkerLine(`x\n  ${COMPLETION_MARKER}  \ny`);
    expect(line).toBeDefined();
    expect(line!.trim()).toBe(COMPLETION_MARKER);
  });

  it('선언이 있으면 mentionsMarkerWithoutDeclaring 은 거짓(서명이 상호배타)', () => {
    const screen = `언급: GOAL-COMPLETE 를 곧 씁니다\n${COMPLETION_MARKER}\n`;
    expect(hasCompletionMarker(screen)).toBe(true);
    expect(mentionsMarkerWithoutDeclaring(screen)).toBe(false);
  });
});

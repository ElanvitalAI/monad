// 문맥관리 트랙 C4 — 압축후 파일 재-read 힌트 배선 검증 (2026-07-19)
//
// midloop compaction 은 합성 재현 불가(FEATURE-compaction §7). 따라서 (1) 상수 내용(재-read 지시)의
// import 가능성 + (2) 압축 지점 배선(missionContext 가드 안에서 history.push)을 검증한다.
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MISSION_COMPACT_REREAD_HINT } from '../src/llm.js';

describe('C4 — 압축후 재-read 힌트', () => {
  test('힌트 상수가 재-read 지시를 담는다', () => {
    expect(MISSION_COMPACT_REREAD_HINT).toContain('압축');
    expect(MISSION_COMPACT_REREAD_HINT).toMatch(/다시 읽|재-?read|Read\/Grep/i);
    expect(MISSION_COMPACT_REREAD_HINT).toContain('Relevant files');
  });

  test('압축 지점에서 missionContext 가드 안에 history.push 배선', () => {
    const llmSrc = readFileSync(join(import.meta.dir, '..', 'src/llm.ts'), 'utf8');
    // C1 관측 방출 직후, 같은 missionContext 블록 안에서 재-read 힌트 push.
    const block = llmSrc.slice(llmSrc.indexOf("debug.log('mission.walker', 'compact'"));
    const push = block.indexOf('history.push({ role: \'system\', content: MISSION_COMPACT_REREAD_HINT })');
    expect(push).toBeGreaterThanOrEqual(0);
    // push 가 missionContext 가드(if (opts.missionContext))보다 뒤 — 일반 채팅 무영향.
    const guard = llmSrc.lastIndexOf('if (opts.missionContext)', llmSrc.indexOf('MISSION_COMPACT_REREAD_HINT', llmSrc.indexOf("'tool-loop.midloop-compact'")));
    expect(guard).toBeGreaterThanOrEqual(0);
  });
});

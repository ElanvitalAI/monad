// 문맥관리 트랙 C1 — walker 압축 observe-gate 1급화 배선 검증 (2026-07-19)
//
// midloop compaction 은 합성 재현 불가(FEATURE-compaction-system §7: 메시지 수 감소=L3 실 summarizer 필요).
// 따라서 이 phase 의 검증은 source-level 배선 assertion(feedback_source_level_grep_test_value) — missionContext
// 가 walker→streamLLMWithTools 로 threading 되고, compaction 지점에서 mission.walker 관측이 방출되는지.
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeWalkerToolArgs } from '../src/llm.js';

const root = join(import.meta.dir, '..');
const llmSrc = readFileSync(join(root, 'src/llm.ts'), 'utf8');
const chatSrc = readFileSync(join(root, 'src/session/chat.ts'), 'utf8');

describe('C1 — walker 압축 observe-gate 1급화 배선', () => {
  test('streamLLMWithTools opts 가 missionContext 를 받는다', () => {
    // 시그니처 인라인 타입에 missionContext(missionId/phaseId) 확장. onOverload(#4900) 추가돼도 견고하게
    // 두 필드 존재만 확인(닫는 중괄호까지 고정하지 않음 — 필드 추가에 취약하지 않게).
    expect(llmSrc).toMatch(/missionContext\?:\s*\{\s*missionId:\s*string;\s*phaseId:\s*string/);
  });

  test('compaction 성공 지점에서 mission.walker.compact 를 missionContext 와 함께 방출', () => {
    // 기존 llm.router 로그는 유지(하위호환) + 미션 관측 추가.
    expect(llmSrc).toContain("debug.log('llm.router', 'tool-loop.midloop-compact'");
    expect(llmSrc).toMatch(/if\s*\(opts\.missionContext\)\s*\{[\s\S]*?debug\.log\('mission\.walker',\s*'compact',\s*\{\s*\.\.\.opts\.missionContext/);
  });

  test('compaction 실패 지점에서 mission.walker.compact-error 방출', () => {
    expect(llmSrc).toMatch(/debug\.log\('mission\.walker',\s*'compact-error',\s*\{\s*\.\.\.opts\.missionContext/);
  });

  test('미션 관측은 missionContext 있을 때만(일반 채팅 무영향)', () => {
    // 방출이 opts.missionContext 가드 안에 있어야 — 무조건 방출이면 일반 채팅도 오염.
    const compactBlock = llmSrc.slice(llmSrc.indexOf("'tool-loop.midloop-compact'"));
    const missionEmit = compactBlock.indexOf("'mission.walker', 'compact'");
    const guard = compactBlock.lastIndexOf('if (opts.missionContext)', missionEmit);
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(missionEmit);
  });

  test('chat.ts runTurn 이 missionContext 를 streamLLMWithTools 로 threading', () => {
    // RunTurnOptions.missionContext → streamLLMWithTools 세 번째 인자 passthrough(조건부).
    expect(chatSrc).toMatch(/missionContext\?:\s*\{\s*missionId:\s*string;\s*phaseId:\s*string/);
    expect(chatSrc).toMatch(/\.\.\.\(opts\.missionContext\s*\?\s*\{\s*missionContext:\s*opts\.missionContext\s*\}\s*:\s*\{\}\)/);
  });
});

// walker 실행 관측성 전면 보강(2026-07-21·제1원칙) — turn/tool/liveness(llm.ts) + goal-loop/premise(run-mission.ts).
// midloop compaction 처럼 라이브 실행은 합성 재현 어려워 source-level 배선 assertion(feedback_source_level_grep_test_value).
const runMissionSrc = readFileSync(join(root, 'scripts/run-mission.ts'), 'utf8');
describe('walker 실행 관측 — turn/tool/liveness (llm.ts)', () => {
  test('turn 진행을 mission.walker.turn 으로 방출(missionContext 가드)', () => {
    expect(llmSrc).toMatch(/if\s*\(opts\.missionContext\)\s*debug\.log\('mission\.walker',\s*'turn',\s*\{\s*\.\.\.opts\.missionContext[\s\S]*?toolCalls[\s\S]*?respChars[\s\S]*?elapsedMs/);
  });
  test('tool 실행 시작/완료를 mission.walker.tool 로(phase start/done)', () => {
    expect(llmSrc).toMatch(/debug\.log\('mission\.walker',\s*'tool',\s*\{\s*\.\.\.opts\.missionContext[\s\S]*?phase:\s*'start'[\s\S]*?argsSummary/);
    expect(llmSrc).toMatch(/debug\.log\('mission\.walker',\s*'tool',\s*\{\s*\.\.\.opts\.missionContext[\s\S]*?phase:\s*'done'[\s\S]*?ok:/);
  });
  test('장시간 tool liveness heartbeat 를 mission.walker.tool-heartbeat 로(hang 오판 방지)', () => {
    expect(llmSrc).toMatch(/debug\.log\('mission\.walker',\s*'tool-heartbeat',\s*\{\s*\.\.\.opts\.missionContext/);
  });
  test('tool 관측은 missionContext 가드 안(일반 채팅/LLM 무영향)', () => {
    const disp = llmSrc.slice(llmSrc.indexOf('result = await handlers.dispatchTool') - 1200, llmSrc.indexOf('result = await handlers.dispatchTool'));
    expect(disp).toMatch(/if\s*\(opts\.missionContext\)\s*debug\.log\('mission\.walker',\s*'tool'/);
  });
  test('summarizeWalkerToolArgs 는 command/file/pattern 식별 필드를 뽑는다', () => {
    expect(summarizeWalkerToolArgs('Bash', { command: 'bun test x' })).toContain('bun test');
    expect(summarizeWalkerToolArgs('Read', { file_path: '/a/b.ts' })).toContain('/a/b.ts');
    expect(summarizeWalkerToolArgs('Grep', { pattern: 'foo', path: 'src' })).toContain('foo');
    // 긴 command 는 절단(verbose 폭증 방지).
    expect(summarizeWalkerToolArgs('Bash', { command: 'x'.repeat(500) }).length).toBeLessThan(200);
  });
});

describe('walker 실행 관측 — goal-loop/premise (run-mission.ts)', () => {
  test('재시도 회차/사유/진전을 mission.walker.goal-loop 로', () => {
    expect(runMissionSrc).toMatch(/debug\.log\('mission\.walker',\s*'goal-loop',\s*\{[\s\S]*?attempt:[\s\S]*?progressed:/);
  });
  test('wm-inject 에 premise 건수 포함(도착 관측)', () => {
    expect(runMissionSrc).toMatch(/debug\.log\('mission\.exec\.context',\s*'wm-inject'[\s\S]*?premises:/);
  });
  test('프롬프트 주입 premise 구성을 premise-inject 로(실주입 관측)', () => {
    expect(runMissionSrc).toMatch(/debug\.log\('mission\.exec\.context',\s*'premise-inject'[\s\S]*?promptChars:/);
  });
  test('walker 방출(decisions/deviation)을 premise-applied 로(활용 관측)', () => {
    expect(runMissionSrc).toMatch(/debug(Log)?\.log\('mission\.walker',\s*'premise-applied',\s*\{[\s\S]*?decisions:/);
  });
});
